import { generateUUID, deepSetValue, deepAccess, isArray, isFn, isPlainObject, logError, logWarn } from '../src/utils.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, VIDEO } from '../src/mediaTypes.js';
import { COMMON_ORTB_VIDEO_PARAMS, formatResponse } from '../libraries/deepintentUtils/index.js';
import { addDealCustomTargetings, addPMPDeals } from '../libraries/dealUtils/dealUtils.js';

const LOG_WARN_PREFIX = 'DeepIntent: ';
const BIDDER_CODE = 'deepintent';
const GVL_ID = 541;
const BIDDER_ENDPOINT = 'https://prebid.deepintent.com/prebid';
const USER_SYNC_URL = 'https://cdn.deepintent.com/syncpixel.html';
const DI_M_V = '1.0.0';
export const ORTB_VIDEO_PARAMS = {
  ...COMMON_ORTB_VIDEO_PARAMS,
  'plcmt': (value) => Array.isArray(value) && value.every(v => v >= 1 && v <= 5),
  'delivery': (value) => [1, 2, 3].indexOf(value) !== -1,
  'pos': (value) => [0, 1, 2, 3, 4, 5, 6, 7].indexOf(value) !== -1,
};
export const spec = {
  code: BIDDER_CODE,
  gvlid: GVL_ID,
  supportedMediaTypes: [BANNER, VIDEO],
  aliases: [],

  // tagId is mandatory param
  isBidRequestValid: bid => {
    let valid = false;
    if (bid && bid.params && bid.params.tagId) {
      if (typeof bid.params.tagId === 'string' || bid.params.tagId instanceof String) {
        if (bid.hasOwnProperty('mediaTypes') && bid.mediaTypes.hasOwnProperty(VIDEO)) {
          if (bid.mediaTypes[VIDEO].hasOwnProperty('context')) {
            valid = true;
          }
        } else {
          valid = true;
        }
      }
    }
    return valid;
  },
  interpretResponse: function(bidResponse, bidRequest) {
    const responses = [];
    if (bidResponse && bidResponse.body) {
      try {
        const bids = bidResponse.body.seatbid && bidResponse.body.seatbid[0] ? bidResponse.body.seatbid[0].bid : [];
        if (bids) {
          bids.forEach(bidObj => {
            const newBid = formatResponse(bidObj);
            const mediaType = _checkMediaType(bidObj);
            if (mediaType === BANNER) {
              newBid.mediaType = BANNER;
            } else if (mediaType === VIDEO) {
              newBid.mediaType = VIDEO;
              newBid.vastXml = bidObj.adm;
            }
            responses.push(newBid);
          });
        }
      } catch (err) {
        logError(err);
      }
    }
    return responses;
  },
  buildRequests: function (validBidRequests, bidderRequest) {
    var user = validBidRequests.map(bid => buildUser(bid));
    clean(user);
    const openRtbBidRequest = {
      id: generateUUID(),
      at: 1,
      imp: validBidRequests.map(bid => buildImpression(bid)),
      site: buildSite(bidderRequest),
      device: buildDevice(),
      user: user && user.length === 1 ? user[0] : {}
    };

    if (bidderRequest && bidderRequest.uspConsent) {
      deepSetValue(openRtbBidRequest, 'regs.ext.us_privacy', bidderRequest.uspConsent);
    }

    if (bidderRequest && bidderRequest.gdprConsent) {
      deepSetValue(openRtbBidRequest, 'user.ext.consent', bidderRequest.gdprConsent.consentString);
      deepSetValue(openRtbBidRequest, 'regs.ext.gdpr', (bidderRequest.gdprConsent.gdprApplies ? 1 : 0));
    }

    // GPP Consent
    if (bidderRequest?.gppConsent?.gppString) {
      deepSetValue(openRtbBidRequest, 'regs.gpp', bidderRequest.gppConsent.gppString);
      deepSetValue(openRtbBidRequest, 'regs.gpp_sid', bidderRequest.gppConsent.applicableSections);
    } else if (bidderRequest?.ortb2?.regs?.gpp) {
      deepSetValue(openRtbBidRequest, 'regs.gpp', bidderRequest.ortb2.regs.gpp);
      deepSetValue(openRtbBidRequest, 'regs.gpp_sid', bidderRequest.ortb2.regs.gpp_sid);
    }

    // coppa compliance
    if (bidderRequest?.ortb2?.regs?.coppa) {
      deepSetValue(openRtbBidRequest, 'regs.coppa', 1);
    }

    injectEids(openRtbBidRequest, validBidRequests);

    return {
      method: 'POST',
      url: BIDDER_ENDPOINT,
      data: JSON.stringify(openRtbBidRequest),
      options: {
        contentType: 'application/json'
      }
    };
  },
  /**
   * Register User Sync.
   */
  getUserSyncs: syncOptions => {
    if (syncOptions.iframeEnabled) {
      return [{
        type: 'iframe',
        url: USER_SYNC_URL
      }];
    }
  }

};
function _checkMediaType(bid) {
  const videoRegex = new RegExp(/VAST\s+version/);
  let mediaType;
  if (bid.adm && bid.adm.indexOf('deepintent_wrapper') >= 0) {
    mediaType = BANNER;
  } else if (videoRegex.test(bid.adm)) {
    mediaType = VIDEO;
  }
  return mediaType;
}

function clean(obj) {
  for (const propName in obj) {
    if (obj[propName] === null || obj[propName] === undefined) {
      delete obj[propName];
    }
  }
}

function buildImpression(bid) {
  let impression = {};
  const floor = getFloor(bid);
  impression = {
    id: bid.bidId,
    tagid: bid.params.tagId || '',
    ...(!isNaN(floor) && { bidfloor: floor }),
    secure: window.location.protocol === 'https:' ? 1 : 0,
    displaymanager: 'di_prebid',
    displaymanagerver: DI_M_V,
    ext: buildCustomParams(bid)
  };
  if (deepAccess(bid, 'mediaTypes.banner')) {
    impression['banner'] = buildBanner(bid);
  }
  if (deepAccess(bid, 'mediaTypes.video')) {
    impression['video'] = _buildVideo(bid);
  }
  if (deepAccess(bid, 'params.deals')) {
    addPMPDeals(impression, deepAccess(bid, 'params.deals'), LOG_WARN_PREFIX);
  }
  if (deepAccess(bid, 'params.dctr')) {
    addDealCustomTargetings(impression, deepAccess(bid, 'params.dctr'), LOG_WARN_PREFIX);
  }
  return impression;
}

function getFloor(bidRequest) {
  if (!isFn(bidRequest.getFloor)) {
    return bidRequest.params?.bidfloor;
  }

  const floor = bidRequest.getFloor({
    currency: 'USD',
    mediaType: '*',
    size: '*'
  });

  if (isPlainObject(floor) && !isNaN(floor.floor) && floor.currency === 'USD') {
    return floor.floor;
  }
  return null;
}

function _buildVideo(bid) {
  const videoObj = {};
  const videoAdUnitParams = deepAccess(bid, 'mediaTypes.video', {});
  const videoBidderParams = deepAccess(bid, 'params.video', {});
  const computedParams = {};

  if (Array.isArray(videoAdUnitParams.playerSize)) {
    const tempSize = (Array.isArray(videoAdUnitParams.playerSize[0])) ? videoAdUnitParams.playerSize[0] : videoAdUnitParams.playerSize;
    computedParams.w = tempSize[0];
    computedParams.h = tempSize[1];
  }

  const videoParams = {
    ...computedParams,
    ...videoAdUnitParams,
    ...videoBidderParams
  };

  Object.keys(ORTB_VIDEO_PARAMS).forEach(paramName => {
    if (videoParams.hasOwnProperty(paramName)) {
      if (ORTB_VIDEO_PARAMS[paramName](videoParams[paramName])) {
        videoObj[paramName] = videoParams[paramName];
      } else {
        logWarn(`The OpenRTB video param ${paramName} has been skipped due to misformating. Please refer to OpenRTB 2.5 spec.`);
      }
    }
  });

  return videoObj;
};

function buildCustomParams(bid) {
  if (bid.params && bid.params.custom) {
    return {
      deepintent: bid.params.custom

    }
  } else {
    return {}
  }
}
function buildUser(bid) {
  if (bid && bid.params && bid.params.user) {
    return {
      id: bid.params.user.id && typeof bid.params.user.id == 'string' ? bid.params.user.id : undefined,
      buyeruid: bid.params.user.buyeruid && typeof bid.params.user.buyeruid == 'string' ? bid.params.user.buyeruid : undefined,
      yob: bid.params.user.yob && typeof bid.params.user.yob == 'number' ? bid.params.user.yob : null,
      gender: bid.params.user.gender && typeof bid.params.user.gender == 'string' ? bid.params.user.gender : undefined,
      keywords: bid.params.user.keywords && typeof bid.params.user.keywords == 'string' ? bid.params.user.keywords : undefined,
      customdata: bid.params.user.customdata && typeof bid.params.user.customdata == 'string' ? bid.params.user.customdata : undefined
    }
  }
}

function injectEids(openRtbBidRequest, validBidRequests) {
  const bidUserIdAsEids = deepAccess(validBidRequests, '0.userIdAsEids');
  if (isArray(bidUserIdAsEids) && bidUserIdAsEids.length > 0) {
    deepSetValue(openRtbBidRequest, 'user.eids', bidUserIdAsEids);
    deepSetValue(openRtbBidRequest, 'user.ext.eids', bidUserIdAsEids);
  }
}

function buildBanner(bid) {
  if (deepAccess(bid, 'mediaTypes.banner')) {
    // Get Sizes from MediaTypes Object, Will always take first size, will be overrided by params for exact w,h
    if (deepAccess(bid, 'mediaTypes.banner.sizes') && !bid.params.height && !bid.params.width) {
      const sizes = deepAccess(bid, 'mediaTypes.banner.sizes');
      if (isArray(sizes) && sizes.length > 0) {
        return {
          h: sizes[0][1],
          w: sizes[0][0],
          pos: bid && bid.params && bid.params.pos ? bid.params.pos : 0
        }
      }
    } else {
      return {
        h: bid.params.height,
        w: bid.params.width,
        pos: bid && bid.params && bid.params.pos ? bid.params.pos : 0
      }
    }
  }
}

function buildSite(bidderRequest) {
  const site = {};
  if (bidderRequest && bidderRequest.refererInfo && bidderRequest.refererInfo.page) {
    site.page = bidderRequest.refererInfo.page;
    site.domain = bidderRequest.refererInfo.domain;
  }
  return site;
}

function buildDevice() {
  return {
    ua: navigator.userAgent,
    js: 1,
    dnt: (navigator.doNotTrack == 'yes' || navigator.doNotTrack === '1') ? 1 : 0,
    h: screen.height,
    w: screen.width,
    language: navigator.language
  }
}

registerBidder(spec);
