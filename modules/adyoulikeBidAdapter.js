import {buildUrl, deepAccess, parseSizesInput} from '../src/utils.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import { config } from '../src/config.js';
import {BANNER, NATIVE, VIDEO} from '../src/mediaTypes.js';
import { convertOrtbRequestToProprietaryNative } from '../src/native.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 * @typedef {import('../src/adapters/bidderFactory.js').BidderRequest} BidderRequest
 * @typedef {import('../src/adapters/bidderFactory.js').UserSync} UserSync
 */

const VERSION = '1.0';
const BIDDER_CODE = 'adyoulike';
const DEFAULT_DC = 'hb-api';
const CURRENCY = 'USD';
const GVLID = 259;

const NATIVE_IMAGE = {
  image: {
    required: true
  },
  title: {
    required: true
  },
  sponsoredBy: {
    required: true
  },
  clickUrl: {
    required: true
  },
  body: {
    required: false
  },
  icon: {
    required: false
  },
  cta: {
    required: false
  }
};

export const spec = {
  code: BIDDER_CODE,
  gvlid: GVLID,
  supportedMediaTypes: [BANNER, NATIVE, VIDEO],
  aliases: ['ayl'], // short code
  /**
   * Determines whether or not the given bid request is valid.
   *
   * @param {BidRequest} bid The bid params to validate.
   * @return boolean True if this is a valid bid, and false otherwise.
   */
  isBidRequestValid: function (bid) {
    const sizes = getSize(getSizeArray(bid));
    const sizeValid = sizes.width > 0 && sizes.height > 0;

    // allows no size for native only
    return (bid.params && bid.params.placement &&
            (sizeValid || (bid.mediaTypes && bid.mediaTypes.native)));
  },
  /**
   * Make a server request from the list of BidRequests.
   *
   * @param {BidRequest} bidRequests is an array of AdUnits and bids
   * @param {BidderRequest} bidderRequest
   * @return ServerRequest Info describing the request to the server.
   */
  buildRequests: function (bidRequests, bidderRequest) {
    // convert Native ORTB definition to old-style prebid native definition
    bidRequests = convertOrtbRequestToProprietaryNative(bidRequests);
    let hasVideo = false;
    let eids;
    const payload = {
      Version: VERSION,
      Bids: bidRequests.reduce((accumulator, bidReq) => {
        const mediatype = getMediatype(bidReq);
        const sizesArray = getSizeArray(bidReq);
        const size = getSize(sizesArray);
        accumulator[bidReq.bidId] = {};
        accumulator[bidReq.bidId].PlacementID = bidReq.params.placement;
        accumulator[bidReq.bidId].TransactionID = bidReq.ortb2Imp?.ext?.tid;
        accumulator[bidReq.bidId].Width = size.width;
        accumulator[bidReq.bidId].Height = size.height;
        accumulator[bidReq.bidId].AvailableSizes = sizesArray.join(',');
        if (typeof bidReq.getFloor === 'function') {
          accumulator[bidReq.bidId].Pricing = getFloor(bidReq, size, mediatype);
        }
        const schain = bidReq?.ortb2?.source?.ext?.schain;
        if (schain) {
          accumulator[bidReq.bidId].SChain = schain;
        }
        if (!eids && bidReq.userIdAsEids && bidReq.userIdAsEids.length) {
          eids = bidReq.userIdAsEids;
        }
        if (mediatype === NATIVE) {
          let nativeReq = bidReq.mediaTypes.native;
          if (nativeReq.type === 'image') {
            nativeReq = Object.assign({}, NATIVE_IMAGE, nativeReq);
          }
          // click url is always mandatory even if not specified by publisher
          nativeReq.clickUrl = {
            required: true
          };
          accumulator[bidReq.bidId].Native = nativeReq;
        }
        if (mediatype === VIDEO) {
          hasVideo = true;
          accumulator[bidReq.bidId].Video = bidReq.mediaTypes.video;

          const size = bidReq.mediaTypes.video.playerSize;
          if (Array.isArray(size) && !Array.isArray(size[0])) {
            accumulator[bidReq.bidId].Video.playerSize = [size];
          }
        }
        return accumulator;
      }, {}),
      PageRefreshed: getPageRefreshed()
    };

    if (bidderRequest.gdprConsent) {
      payload.gdprConsent = {
        consentString: bidderRequest.gdprConsent.consentString,
        consentRequired: (typeof bidderRequest.gdprConsent.gdprApplies === 'boolean') ? bidderRequest.gdprConsent.gdprApplies : null
      };
    }

    if (bidderRequest.uspConsent) {
      payload.uspConsent = bidderRequest.uspConsent;
    }

    if (bidderRequest.ortb2) {
      payload.ortb2 = bidderRequest.ortb2;
    }
    if (eids) {
      payload.eids = eids;
    }

    payload.pbjs_version = '$prebid.version$';

    const data = JSON.stringify(payload);
    const options = {
      withCredentials: true
    };

    return {
      method: 'POST',
      url: createEndpoint(bidRequests, bidderRequest, hasVideo),
      data,
      options
    };
  },
  /**
   * Unpack the response from the server into a list of bids.
   *
   * @param {*} serverResponse A successful response from the server.
   * @return {Bid[]} An array of bids which were nested inside the server.
   */
  interpretResponse: function (serverResponse, request) {
    const bidResponses = [];
    var bidRequests = {};

    if (!serverResponse || !serverResponse.body) {
      return bidResponses;
    }

    try {
      bidRequests = JSON.parse(request.data).Bids;
    } catch (err) {
      // json error initial request can't be read
    }

    // For this adapter, serverResponse is a list
    serverResponse.body.forEach(response => {
      const bid = createBid(response, bidRequests);
      if (bid) {
        bidResponses.push(bid);
      }
    });
    return bidResponses;
  },

  /**
   * List user sync endpoints.
   * Legal information have to be added to the request.
   * Only iframe syncs are supported.
   *
   * @param {*} syncOptions Publisher prebid configuration.
   * @param {*} serverResponses A successful response from the server.
   * @return {UserSync[]} An array of syncs that should be executed.
   */
  getUserSyncs: function (syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) {
    if (!syncOptions.iframeEnabled) {
      return [];
    }

    let params = '';

    // GDPR
    if (gdprConsent) {
      params += '&gdpr=' + (gdprConsent.gdprApplies ? 1 : 0);
      params += '&gdpr_consent=' + encodeURIComponent(gdprConsent.consentString || '');
    }

    // coppa compliance
    if (config.getConfig('coppa') === true) {
      params += '&coppa=1';
    }

    // CCPA
    if (uspConsent) {
      params += '&us_privacy=' + encodeURIComponent(uspConsent);
    }

    // GPP
    if (gppConsent?.gppString && gppConsent?.applicableSections?.length) {
      params += '&gpp=' + encodeURIComponent(gppConsent.gppString);
      params += '&gpp_sid=' + encodeURIComponent(gppConsent?.applicableSections?.join(','));
    }

    return [{
      type: 'iframe',
      url: `https://visitor.omnitagjs.com/visitor/isync?uid=19340f4f097d16f41f34fc0274981ca4${params}`
    }];
  }
}

/* Get hostname from bids */
function getHostname(bidderRequest) {
  const dcHostname = ((bidderRequest) || []).find(bid => bid.params.DC);
  if (dcHostname) {
    return ('-' + dcHostname.params.DC);
  }
  return '';
}

/* Get mediatype from bidRequest */
function getMediatype(bidRequest) {
  if (deepAccess(bidRequest, 'mediaTypes.banner')) {
    return BANNER;
  }
  if (deepAccess(bidRequest, 'mediaTypes.video')) {
    return VIDEO;
  }
  if (deepAccess(bidRequest, 'mediaTypes.native')) {
    return NATIVE;
  }
}

/* Get Floor price information */
function getFloor(bidRequest, size, mediaType) {
  const bidFloors = bidRequest.getFloor({
    currency: CURRENCY,
    mediaType,
    size: [ size.width, size.height ]
  });

  if (!isNaN(bidFloors?.floor) && (bidFloors?.currency === CURRENCY)) {
    return bidFloors.floor;
  }
}

/* Get information on page refresh */
function getPageRefreshed() {
  try {
    if (performance && performance.navigation) {
      return performance.navigation.type === performance.navigation.TYPE_RELOAD;
    }
  } catch (e) { }
  return false;
}

/* Create endpoint url */
function createEndpoint(bidRequests, bidderRequest, hasVideo) {
  const host = getHostname(bidRequests);
  const endpoint = hasVideo ? '/hb-api/prebid-video/v1' : '/hb-api/prebid/v1';
  return buildUrl({
    protocol: 'https',
    host: `${DEFAULT_DC}${host}.omnitagjs.com`,
    pathname: endpoint,
    search: createEndpointQS(bidderRequest)
  });
}

/* Create endpoint query string */
function createEndpointQS(bidderRequest) {
  const qs = {};
  if (bidderRequest) {
    const ref = bidderRequest.refererInfo;
    if (ref) {
      if (ref.location) {
        // RefererUrl will be removed in a future version.
        qs.RefererUrl = encodeURIComponent(ref.location);
        if (!ref.reachedTop) {
          qs.SafeFrame = true;
        }
      }

      qs.PageUrl = encodeURIComponent(ref.topmostLocation);
      qs.PageReferrer = encodeURIComponent(ref.location);
    }

    // retrieve info from ortb2 object if present (prebid7)
    const siteInfo = bidderRequest.ortb2?.site;
    if (siteInfo) {
      qs.PageUrl = encodeURIComponent(siteInfo.page || ref?.topmostLocation);
      qs.PageReferrer = encodeURIComponent(siteInfo.ref || ref?.location);
    }
  }

  const can = bidderRequest?.refererInfo?.canonicalUrl;
  if (can) {
    qs.CanonicalUrl = encodeURIComponent(can);
  }

  return qs;
}

function getSizeArray(bid) {
  let inputSize = bid.sizes || [];

  if (bid.mediaTypes && bid.mediaTypes.banner) {
    inputSize = bid.mediaTypes.banner.sizes || [];
  }

  // handle size in bid.params in formats: [w, h] and [[w,h]].
  if (bid.params && Array.isArray(bid.params.size)) {
    inputSize = bid.params.size;
    if (!Array.isArray(inputSize[0])) {
      inputSize = [inputSize]
    }
  }

  return parseSizesInput(inputSize);
}

/* Get parsed size from request size */
function getSize(sizesArray) {
  const parsed = {};
  // the main requested size is the first one
  const size = sizesArray[0];

  if (typeof size !== 'string') {
    return parsed;
  }

  const parsedSize = size.toUpperCase().split('X');
  const width = parseInt(parsedSize[0], 10);
  if (width) {
    parsed.width = width;
  }

  const height = parseInt(parsedSize[1], 10);
  if (height) {
    parsed.height = height;
  }

  return parsed;
}

function getInternalImgUrl(uid) {
  if (!uid) return '';
  return 'https://blobs.omnitagjs.com/blobs/' + uid.substr(16, 2) + '/' + uid.substr(16) + '/' + uid;
}

function getImageUrl(config, resource, width, height) {
  let url = '';
  if (resource && resource.Kind) {
    switch (resource.Kind) {
      case 'INTERNAL':
        url = getInternalImgUrl(resource.Data.Internal.BlobReference.Uid);

        break;

      case 'EXTERNAL':
        const dynPrefix = config.DynamicPrefix;
        let extUrl = resource.Data.External.Url;
        extUrl = extUrl.replace(/\[height\]/i, '' + height);
        extUrl = extUrl.replace(/\[width\]/i, '' + width);

        if (extUrl.indexOf(dynPrefix) >= 0) {
          const urlmatch = (/.*url=([^&]*)/gm).exec(extUrl);
          url = urlmatch ? urlmatch[1] : '';
          if (!url) {
            url = getInternalImgUrl((/.*key=([^&]*)/gm).exec(extUrl)[1]);
          }
        } else {
          url = extUrl;
        }

        break;
    }
  }

  return url;
}

function getTrackers(eventsArray, jsTrackers) {
  const result = [];

  if (!eventsArray) return result;

  eventsArray.map((item, index) => {
    if ((jsTrackers && item.Kind === 'JAVASCRIPT_URL') ||
        (!jsTrackers && item.Kind === 'PIXEL_URL')) {
      result.push(item.Url);
    }
  });
  return result;
}

function getNativeAssets(response, nativeConfig) {
  if (typeof response.Native === 'object') {
    return response.Native;
  }
  const native = {};

  var adJson = {};
  var textsJson = {};
  if (typeof response.Ad === 'string') {
    adJson = JSON.parse(response.Ad.match(/\/\*PREBID\*\/(.*)\/\*PREBID\*\//)[1]);
    textsJson = adJson.Content.Preview.Text;

    var impressionUrl = adJson.TrackingPrefix +
            '/pixel?event_kind=IMPRESSION&attempt=' + adJson.Attempt;
    var insertionUrl = adJson.TrackingPrefix +
            '/pixel?event_kind=INSERTION&attempt=' + adJson.Attempt;

    if (adJson.Campaign) {
      impressionUrl += '&campaign=' + adJson.Campaign;
      insertionUrl += '&campaign=' + adJson.Campaign;
    }

    native.clickUrl = adJson.TrackingPrefix + '/ar?event_kind=CLICK&attempt=' + adJson.Attempt +
      '&campaign=' + adJson.Campaign + '&url=' + encodeURIComponent(adJson.Content.Landing.Url);

    if (adJson.OnEvents) {
      native.clickTrackers = getTrackers(adJson.OnEvents['CLICK']);
      native.impressionTrackers = getTrackers(adJson.OnEvents['IMPRESSION']);
      native.javascriptTrackers = getTrackers(adJson.OnEvents['IMPRESSION'], true);
    } else {
      native.impressionTrackers = [];
    }

    native.impressionTrackers.push(impressionUrl, insertionUrl);
  }

  Object.keys(nativeConfig).map(function(key, index) {
    switch (key) {
      case 'title':
        native[key] = textsJson.TITLE;
        break;
      case 'body':
        native[key] = textsJson.DESCRIPTION;
        break;
      case 'cta':
        native[key] = textsJson.CALLTOACTION;
        break;
      case 'sponsoredBy':
        native[key] = adJson.Content.Preview.Sponsor.Name;
        break;
      case 'image':
        // main image requested size
        const imgSize = nativeConfig.image.sizes || [];
        if (!imgSize.length) {
          imgSize[0] = response.Width || 300;
          imgSize[1] = response.Height || 250;
        }

        const url = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Thumbnail.Image'), imgSize[0], imgSize[1]);
        if (url) {
          native[key] = {
            url,
            width: imgSize[0],
            height: imgSize[1]
          };
        }

        break;
      case 'icon':
        // icon requested size
        const iconSize = nativeConfig.icon.sizes || [];
        if (!iconSize.length) {
          iconSize[0] = 50;
          iconSize[1] = 50;
        }

        const icurl = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Sponsor.Logo.Resource'), iconSize[0], iconSize[1]);

        if (icurl) {
          native[key] = {
            url: icurl,
            width: iconSize[0],
            height: iconSize[1]
          };
        }
        break;
      case 'privacyIcon':
        native[key] = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Credit.Logo.Resource'), 25, 25);
        break;
      case 'privacyLink':
        native[key] = deepAccess(adJson, 'Content.Preview.Credit.Url');
        break;
    }
  });

  return native;
}

/* Create bid from response */
function createBid(response, bidRequests) {
  if (!response || (!response.Ad && !response.Native && !response.Vast)) {
    return;
  }

  const request = bidRequests && bidRequests[response.BidID];

  // In case we don't retrieve the size from the adserver, use the given one.
  if (request) {
    if (!response.Width || response.Width === '0') {
      response.Width = request.Width;
    }

    if (!response.Height || response.Height === '0') {
      response.Height = request.Height;
    }
  }

  const bid = {
    requestId: response.BidID,
    ttl: 3600,
    creativeId: response.CreativeID,
    cpm: response.Price,
    netRevenue: true,
    currency: CURRENCY,
    meta: response.Meta || { advertiserDomains: [] }
  };

  // retrieve video response if present
  const vast64 = response.Vast;
  if (vast64) {
    bid.width = response.Width;
    bid.height = response.Height;
    bid.vastXml = window.atob(vast64);
    bid.mediaType = 'video';
  } else if (request.Native) {
    // format Native response if Native was requested
    bid.native = getNativeAssets(response, request.Native);
    bid.mediaType = 'native';
  } else {
    bid.width = response.Width;
    bid.height = response.Height;
    bid.ad = response.Ad;
  }

  return bid;
}

registerBidder(spec);
