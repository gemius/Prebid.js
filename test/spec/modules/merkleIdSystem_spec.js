import * as ajaxLib from 'src/ajax.js';
import * as utils from 'src/utils.js';
import {merkleIdSubmodule} from 'modules/merkleIdSystem.js';

import sinon from 'sinon';
import {createEidsArray} from '../../../modules/userId/eids.js';
import {attachIdSystem} from '../../../modules/userId/index.js';

const expect = require('chai').expect;

const CONFIG_PARAMS = {
  endpoint: undefined,
  ssp_ids: ['ssp-1'],
  sv_pubid: '11314',
  sv_domain: 'www.testDomain.com',
  sv_session: 'testsession'
};

const STORAGE_PARAMS = {
  type: 'cookie',
  name: 'merkle',
  expires: 10,
  refreshInSeconds: 10
};

const MOCK_RESPONSE = {
  c: {
    name: '_svsid',
    value: '123876327647627364236478'
  }
};

function mockResponse(
  responseText,
  response = (url, successCallback) => successCallback(responseText)) {
  return function() {
    return response;
  }
}

describe('Merkle System', function () {
  describe('merkleIdSystem.decode()', function() {
    it('provides multiple Merkle IDs (EID) from a stored object', function() {
      const storage = {
        merkleId: [{
          id: 'some-random-id-value', ext: { enc: 1, keyID: 16, idName: 'pamId', ssp: 'ssp1' }
        }, {
          id: 'another-random-id-value',
          ext: {
            enc: 1,
            idName: 'pamId',
            third: 4,
            ssp: 'ssp2'
          }
        }],
        _svsid: 'some-identifier'
      };

      expect(merkleIdSubmodule.decode(storage)).to.deep.equal({
        merkleId: storage.merkleId
      });
    });

    it('can decode legacy stored object', function() {
      const merkleId = {'pam_id': {'id': 'testmerkleId', 'keyID': 1}};

      expect(merkleIdSubmodule.decode(merkleId)).to.deep.equal({
        merkleId: {'id': 'testmerkleId', 'keyID': 1}
      });
    })

    it('returns undefined', function() {
      const merkleId = {};
      expect(merkleIdSubmodule.decode(merkleId)).to.be.undefined;
    })
  });

  describe('Merkle System getId()', function () {
    const callbackSpy = sinon.spy();
    let sandbox;
    let ajaxStub;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      sinon.stub(utils, 'logInfo');
      sinon.stub(utils, 'logWarn');
      sinon.stub(utils, 'logError');
      callbackSpy.resetHistory();
      ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockResponse(JSON.stringify(MOCK_RESPONSE)));
    });

    afterEach(function () {
      utils.logInfo.restore();
      utils.logWarn.restore();
      utils.logError.restore();
      ajaxStub.restore();
    });

    it('getId() should fail on missing sv_pubid', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          sv_pubid: undefined
        },
        storage: STORAGE_PARAMS
      };

      const submoduleCallback = merkleIdSubmodule.getId(config, undefined);
      expect(submoduleCallback).to.be.undefined;
      expect(utils.logError.args[0][0]).to.exist.and.to.equal('User ID - merkleId submodule requires a valid sv_pubid string to be defined');
    });

    it('getId() should fail on missing ssp_ids', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          ssp_ids: undefined
        },
        storage: STORAGE_PARAMS
      };

      const submoduleCallback = merkleIdSubmodule.getId(config, undefined);
      expect(submoduleCallback).to.be.undefined;
      expect(utils.logError.args[0][0]).to.exist.and.to.equal('User ID - merkleId submodule requires a valid ssp_ids array to be defined');
    });

    it('getId() should warn on missing endpoint', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          endpoint: undefined
        },
        storage: STORAGE_PARAMS
      };

      const submoduleCallback = merkleIdSubmodule.getId(config, undefined).callback;
      submoduleCallback(callbackSpy);
      expect(callbackSpy.calledOnce).to.be.true;
      expect(utils.logWarn.args[0][0]).to.exist.and.to.equal('User ID - merkleId submodule endpoint string is not defined');
    });

    it('getId() should handle callback with valid configuration', function () {
      const config = {
        params: CONFIG_PARAMS,
        storage: STORAGE_PARAMS
      };

      const submoduleCallback = merkleIdSubmodule.getId(config, undefined).callback;
      submoduleCallback(callbackSpy);
      expect(callbackSpy.calledOnce).to.be.true;
    });

    it('getId() does not handle consent strings', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          ssp_ids: []
        },
        storage: STORAGE_PARAMS
      };

      const submoduleCallback = merkleIdSubmodule.getId(config, {gdpr: {gdprApplies: true}});
      expect(submoduleCallback).to.be.undefined;
      expect(utils.logError.args[0][0]).to.exist.and.to.equal('User ID - merkleId submodule does not currently handle consent strings');
    });
  });

  describe('Merkle System extendId()', function () {
    const callbackSpy = sinon.spy();
    let sandbox;
    let ajaxStub;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      sinon.stub(utils, 'logInfo');
      sinon.stub(utils, 'logWarn');
      sinon.stub(utils, 'logError');
      callbackSpy.resetHistory();
      ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockResponse(JSON.stringify(MOCK_RESPONSE)));
    });

    afterEach(function () {
      utils.logInfo.restore();
      utils.logWarn.restore();
      utils.logError.restore();
      ajaxStub.restore();
    });

    it('extendId() get storedid', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
        },
        storage: STORAGE_PARAMS
      };

      const id = merkleIdSubmodule.extendId(config, undefined, 'Merkle_Stored_ID');
      expect(id.id).to.exist.and.to.equal('Merkle_Stored_ID');
    });

    it('extendId() get storedId on configured storageParam.refreshInSeconds', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          refreshInSeconds: 1000
        },
        storage: STORAGE_PARAMS
      };

      const yesterday = new Date(Date.now() - 86400000).toUTCString();
      const storedId = {value: 'Merkle_Stored_ID', date: yesterday};

      const id = merkleIdSubmodule.extendId(config, undefined,
        storedId);

      expect(id.id).to.exist.and.to.equal(storedId);
    });
    it('extendId() should warn on missing endpoint', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          endpoint: undefined
        },
        storage: STORAGE_PARAMS
      };

      const yesterday = new Date(Date.now() - 86400000).toUTCString();
      const storedId = {value: 'Merkle_Stored_ID', date: yesterday};

      const submoduleCallback = merkleIdSubmodule.extendId(config, undefined,
        storedId).callback;
      submoduleCallback(callbackSpy);
      expect(callbackSpy.calledOnce).to.be.true;
      expect(utils.logWarn.args[0][0]).to.exist.and.to.equal('User ID - merkleId submodule endpoint string is not defined');
    });

    it('extendId() callback on configured storageParam.refreshInSeconds', function () {
      const config = {
        params: {
          ...CONFIG_PARAMS,
          refreshInSeconds: 1
        }
      };

      const yesterday = new Date(Date.now() - 86400000).toUTCString();
      const storedId = {value: 'Merkle_Stored_ID', date: yesterday};

      const submoduleCallback = merkleIdSubmodule.extendId(config, undefined, storedId).callback;
      submoduleCallback(callbackSpy);
      expect(callbackSpy.calledOnce).to.be.true;
    });
  });

  describe('eid', () => {
    before(() => {
      attachIdSystem(merkleIdSubmodule);
    });
    it('merkleId (legacy) - supports single id', function() {
      const userId = {
        merkleId: {
          id: 'some-random-id-value', keyID: 1
        }
      };
      const newEids = createEidsArray(userId);

      expect(newEids.length).to.equal(1);
      expect(newEids[0]).to.deep.equal({
        source: 'merkleinc.com',
        uids: [{
          id: 'some-random-id-value',
          atype: 3,
          ext: { keyID: 1 }
        }]
      });
    });

    it('merkleId supports multiple source providers', function() {
      const userId = {
        merkleId: [{
          id: 'some-random-id-value', ext: { enc: 1, keyID: 16, idName: 'pamId', ssp: 'ssp1' }
        }, {
          id: 'another-random-id-value',
          ext: {
            enc: 1,
            idName: 'pamId',
            third: 4,
            ssp: 'ssp2'
          }
        }]
      }

      const newEids = createEidsArray(userId);
      expect(newEids.length).to.equal(2);
      expect(newEids[0]).to.deep.equal({
        source: 'ssp1.merkleinc.com',
        uids: [{id: 'some-random-id-value',
          atype: 3,
          ext: {
            enc: 1,
            keyID: 16,
            idName: 'pamId',
            ssp: 'ssp1'
          }
        }]
      });
      expect(newEids[1]).to.deep.equal({
        source: 'ssp2.merkleinc.com',
        uids: [{id: 'another-random-id-value',
          atype: 3,
          ext: {
            third: 4,
            enc: 1,
            idName: 'pamId',
            ssp: 'ssp2'
          }
        }]
      });
    });
  })
});
