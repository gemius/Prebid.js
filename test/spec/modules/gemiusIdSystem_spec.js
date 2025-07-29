import { gemiusIdSubmodule } from 'modules/gemiusIdSystem.js';
import * as utils from 'src/utils.js';

describe('GemiusId module', function () {
  let getWindowTopStub;
  let mockWindow;

  beforeEach(function () {
    mockWindow = {
      gemius_cmd: sinon.stub()
    };
    getWindowTopStub = sinon.stub(utils, 'getWindowTop').returns(mockWindow);
  });

  afterEach(function () {
    getWindowTopStub.restore();
  });

  describe('gemiusIdSubmodule', function () {
    it('should have the correct name', function () {
      expect(gemiusIdSubmodule.name).to.equal('gemiusId');
    });

    it('should have correct eids configuration', function () {
      expect(gemiusIdSubmodule.eids.gemiusId).to.deep.include({
        source: 'gemius.com',
        atype: 1
      });
    });

    it('should have correct gvlid', function () {
      expect(gemiusIdSubmodule.gvlid).to.be.a('number');
    });
  });

  describe('getId', function () {
    it('should return undefined if gemius_cmd is not available', function (done) {
      const clock = sinon.useFakeTimers();
      getWindowTopStub.returns({});

      gemiusIdSubmodule.getId().callback((resultId) => {
        expect(resultId).to.be.undefined;
        clock.restore();
        done();
      });

      clock.tick(3100);
    });

    it('should return callback when gemius_cmd is available', function () {
      const result = gemiusIdSubmodule.getId();
      expect(result).to.have.property('callback');
      expect(result.callback).to.be.a('function');
    });

    it('should call gemius_cmd with correct parameters', function (done) {
      mockWindow.gemius_cmd.callsFake((command, callback) => {
        expect(command).to.equal('get_ruid');
        expect(callback).to.be.a('function');

        const testRuid = 'test-ruid-123';
        const statusOk = {status: 'ok'};
        callback(testRuid, statusOk);
      });

      gemiusIdSubmodule.getId().callback((resultId) => {
        expect(resultId).to.deep.equal({id: 'test-ruid-123'});
        expect(mockWindow.gemius_cmd.calledOnce).to.be.true;
        done();
      });
    });

    it('should handle gemius_cmd throwing an error', function (done) {
      mockWindow.gemius_cmd.callsFake(() => {
        throw new Error();
      });

      const result = gemiusIdSubmodule.getId();
      result.callback((resultId) => {
        expect(resultId).to.be.undefined;
        done();
      });
    });

    it('should handle gemius_cmd not calling callback', function (done) {
      const clock = sinon.useFakeTimers();

      mockWindow.gemius_cmd.callsFake((command, callback) => {
        // Don't call callback to simulate timeout/no response
      });

      gemiusIdSubmodule.getId().callback((resultId) => {
        expect(resultId).to.be.undefined;
        clock.restore();
        done();
      });

      clock.tick(8100);
    });
  });

  describe('decode', function () {
    it('should return object with gemiusId when value exists', function () {
      const result = gemiusIdSubmodule.decode({id: 'test-gemius-id'});
      expect(result).to.deep.equal({
        gemiusId: 'test-gemius-id'
      });
    });

    it('should return undefined when value is falsy', function () {
      expect(gemiusIdSubmodule.decode('')).to.be.undefined;
      expect(gemiusIdSubmodule.decode(null)).to.be.undefined;
      expect(gemiusIdSubmodule.decode(undefined)).to.be.undefined;
      expect(gemiusIdSubmodule.decode(0)).to.be.undefined;
      expect(gemiusIdSubmodule.decode(false)).to.be.undefined;
    });
  });
});
