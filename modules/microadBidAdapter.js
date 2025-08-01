import { deepAccess, isArray, isEmpty, isStr } from '../src/utils.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER } from '../src/mediaTypes.js';
import { convertOrtbRequestToProprietaryNative } from '../src/native.js';

const BIDDER_CODE = 'microad';

const ENDPOINT_URLS = {
  'production': 'https://s-rtb-pb.send.microad.jp/prebid',
  'test': 'https://rtbtest.send.microad.jp/prebid'
};
export const ENVIRONMENT = 'production';

/* eslint-disable no-template-curly-in-string */
const EXT_URL_STRING = '${COMPASS_EXT_URL}';
const EXT_REF_STRING = '${COMPASS_EXT_REF}';
const EXT_IFA_STRING = '${COMPASS_EXT_IFA}';
const EXT_APPID_STRING = '${COMPASS_EXT_APPID}';
/* eslint-enable no-template-curly-in-string */

const BANNER_CODE = 1;
const NATIVE_CODE = 2;
const VIDEO_CODE = 4;

const AUDIENCE_IDS = [
  {type: 6, bidKey: 'userId.imuid', source: 'intimatemerger.com'},
  {type: 8, bidKey: 'userId.id5id.uid', source: 'id5-sync.com'},
  {type: 9, bidKey: 'userId.tdid', source: 'adserver.org'},
  {type: 10, bidKey: 'userId.novatiq.snowflake', source: 'novatiq.com'},
  {type: 12, bidKey: 'userId.dacId.id', source: 'dac.co.jp'},
  {type: 13, bidKey: 'userId.idl_env', source: 'liveramp.com'},
  {type: 14, bidKey: 'userId.criteoId', source: 'criteo.com'},
  {type: 15, bidKey: 'userId.pubcid', source: 'pubcid.org'},
  {type: 17, bidKey: 'userId.uid2.id', source: 'uidapi.com'}
];

function createCBT() {
  const randomValue = Math.floor(Math.random() * Math.pow(10, 18)).toString(16);
  const date = new Date().getTime().toString(16);
  return randomValue + date;
}

function createBitSequenceFromMediaType(hi, code) {
  return (hi ? -1 : 0) & code;
}

function convertMediaTypes(bid) {
  return createBitSequenceFromMediaType(bid.mediaTypes.banner, BANNER_CODE) |
    createBitSequenceFromMediaType(bid.mediaTypes.native, NATIVE_CODE) |
    createBitSequenceFromMediaType(bid.mediaTypes.video, VIDEO_CODE);
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],
  isBidRequestValid: function(bid) {
    return !!(bid && bid.params && bid.params.spot && bid.mediaTypes && (bid.mediaTypes.banner || bid.mediaTypes.native || bid.mediaTypes.video));
  },
  buildRequests: function(validBidRequests, bidderRequest) {
    // convert Native ORTB definition to old-style prebid native definition
    validBidRequests = convertOrtbRequestToProprietaryNative(validBidRequests);

    const requests = [];

    validBidRequests.forEach(bid => {
      const bidParams = bid.params;
      const params = {
        spot: bidParams.spot,
        // TODO: are these the right refererInfo values - does the fallback make sense here?
        url: bidderRequest.refererInfo.page || window.location.href,
        referrer: bidderRequest.refererInfo.ref,
        bid_id: bid.bidId,
        transaction_id: bid.ortb2Imp?.ext?.tid,
        media_types: convertMediaTypes(bid),
        cbt: createCBT()
      };

      if (bidParams.url) {
        params['url_macro'] = bidParams.url.replace(EXT_URL_STRING, '');
      }

      if (bidParams.referrer) {
        params['referrer_macro'] = bidParams.referrer.replace(EXT_REF_STRING, '');
      }

      if (bidParams.ifa) {
        params['ifa'] = bidParams.ifa.replace(EXT_IFA_STRING, '');
      }

      if (bidParams.appid) {
        params['appid'] = bidParams.appid.replace(EXT_APPID_STRING, '');
      }

      const aidsParams = []
      const userIdAsEids = bid.userIdAsEids;
      AUDIENCE_IDS.forEach((audienceId) => {
        const bidAudienceId = deepAccess(bid, audienceId.bidKey);
        if (!isEmpty(bidAudienceId) && isStr(bidAudienceId)) {
          const aidParam = { type: audienceId.type, id: bidAudienceId };
          // Set ext
          if (isArray(userIdAsEids)) {
            const targetEid = ((userIdAsEids) || []).find((eid) => eid.source === audienceId.source) || {};
            if (!isEmpty(deepAccess(targetEid, 'uids.0.ext'))) {
              aidParam.ext = targetEid.uids[0].ext;
            }
          }
          aidsParams.push(aidParam);
          // Set Ramp ID
          if (audienceId.type === 13) params['idl_env'] = bidAudienceId;
        }
      })
      if (aidsParams.length > 0) {
        params['aids'] = JSON.stringify(aidsParams)
      }

      const pbadslot = deepAccess(bid, 'ortb2Imp.ext.data.pbadslot');
      const gpid = deepAccess(bid, 'ortb2Imp.ext.gpid');
      if (gpid) {
        params['gpid'] = gpid;
      }

      if (pbadslot) {
        params['pbadslot'] = pbadslot;
      }

      const adservname = deepAccess(bid, 'ortb2Imp.ext.data.adserver.name');
      if (adservname) {
        params['adservname'] = adservname;
      }

      const adservadslot = deepAccess(bid, 'ortb2Imp.ext.data.adserver.adslot');
      if (adservadslot) {
        params['adservadslot'] = adservadslot;
      }

      requests.push({
        method: 'GET',
        url: ENDPOINT_URLS[ENVIRONMENT],
        data: params,
        options: { Accept: 'application/json' }
      });
    });
    return requests;
  },
  interpretResponse: function(serverResponse) {
    const body = serverResponse.body;
    const bidResponses = [];

    if (body.cpm && body.cpm > 0) {
      const bidResponse = {
        requestId: body.requestId,
        cpm: body.cpm,
        width: body.width,
        height: body.height,
        ad: body.ad,
        ttl: body.ttl,
        creativeId: body.creativeId,
        netRevenue: body.netRevenue,
        currency: body.currency,
        meta: body.meta || { advertiserDomains: [] }
      };

      if (body.dealId) {
        bidResponse['dealId'] = body.dealId;
      }

      bidResponses.push(bidResponse);
    }

    return bidResponses;
  },
  getUserSyncs: function(syncOptions, serverResponses) {
    const syncs = [];

    if (!syncOptions.iframeEnabled && !syncOptions.pixelEnabled) {
      return syncs;
    }

    serverResponses.forEach(resp => {
      const syncIframeUrls = resp.body.syncUrls.iframe;
      const syncImageUrls = resp.body.syncUrls.image;
      if (syncOptions.iframeEnabled && syncIframeUrls) {
        syncIframeUrls.forEach(syncIframeUrl => {
          syncs.push({
            type: 'iframe',
            url: syncIframeUrl
          });
        });
      }
      if (syncOptions.pixelEnabled && syncImageUrls) {
        syncImageUrls.forEach(syncImageUrl => {
          syncs.push({
            type: 'image',
            url: syncImageUrl
          });
        });
      }
    });

    return syncs;
  }
};

registerBidder(spec);
