/* global describe,it,beforeEach */
'use strict'
let should = require('should')
let asink = require('asink')
let OutputDescription = require('../../lib/output-description')
let CommitmentTxObj = require('../../lib/txs/commitment-tx-obj')
let FundingTxObj = require('../../lib/txs/funding-tx-obj')
let HtlcSecret = require('../../lib/scrts/htlc-secret')
let RevocationSecret = require('../../lib/scrts/revocation-secret')
let Agent = require('../../lib/agent')
let Wallet = require('../../lib/wallet')
let SecretHelper = require('../test-helpers/secret-helper')
let PrivKey = require('yours-bitcoin/lib/priv-key')
let Bip32 = require('yours-bitcoin/lib/bip-32')
let Bn = require('yours-bitcoin/lib/bn')
let TxVerifier = require('yours-bitcoin/lib/tx-verifier')
let Interp = require('yours-bitcoin/lib/interp')

let bob, carol
let htlcSecret, revocationSecret
let bips, outputList

describe('CommitmentTxObj', function () {
  it('should exist', function () {
    should.exist(CommitmentTxObj)
    should.exist(new CommitmentTxObj())
  })

  beforeEach(function () {
    return asink(function * () {
      bob = new Agent('bob')
      yield bob.asyncInitialize(PrivKey.fromRandom(), PrivKey.fromRandom(), PrivKey.fromRandom())
      bob.funder = true
      carol = new Agent('carol')
      yield carol.asyncInitialize(PrivKey.fromRandom(), PrivKey.fromRandom(), PrivKey.fromRandom())

      bob.other = yield carol.asyncToPublic()
      carol.other = yield bob.asyncToPublic()

      yield bob.multisigAddress.asyncInitialize(bob.other.multisigAddress.pubKey)
      yield carol.multisigAddress.asyncInitialize(carol.other.multisigAddress.pubKey)

      let inputAmountBn = Bn(1e10)
      let fundingAmount = Bn(1e8)
      let wallet = new Wallet()
      let output = wallet.getUnspentOutput(inputAmountBn, bob.sourceAddress.keyPair.pubKey)

      let fundingTxObj = new FundingTxObj()
      yield fundingTxObj.asyncInitialize(
        fundingAmount,
        bob.sourceAddress,
        bob.multisigAddress,
        output.txhashbuf,
        output.txoutnum,
        output.txout,
        output.pubKey,
        output.inputTxout)

      bob.fundingTxObj = carol.fundingTxObj = fundingTxObj

      htlcSecret = new HtlcSecret()
      yield htlcSecret.asyncInitialize()
      revocationSecret = new RevocationSecret()
      yield revocationSecret.asyncInitialize()

      let bobBip32 = new Bip32().fromRandom()
      let bobBip32Public = bobBip32.toPublic()
      let carolBip32 = new Bip32().fromRandom()
      let carolBip32Public = carolBip32.toPublic()
      bips = {
        bob: bobBip32Public,
        carol: carolBip32Public
      }

      outputList = [
        new OutputDescription(
          'htlc',
          'alice', 'bob', 'carol', 'dave',
          'm/1/2', 'm/4/5',
          htlcSecret, revocationSecret,
          Bn(1e7)),
        new OutputDescription(
          'pubKey',
          'alice', 'bob', 'carol', 'dave',
          'm/1/2', 'm/4/5',
          htlcSecret, revocationSecret,
          Bn(1e7))
      ]
    }, this)
  })

  it('build without signing', function () {
    return asink(function * () {
      let commitmentTxObj = new CommitmentTxObj()
      commitmentTxObj.outputList = outputList
      yield commitmentTxObj.asyncBuild(
        bob.fundingTxObj.txb,
        bob.multisigAddress,
        carol.id,
        bips)

      let txVerifier, error
      txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
      error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
      // we expect an error here as the transaction is not fully signed
      error.should.equal('input 0 failed script verify')
    }, this)
  })

  describe('#asyncBuild', function () {
    it('case with only a change output', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = [
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7))
        ]
        yield commitmentTxObj.asyncBuild(
          carol.fundingTxObj.txb,
          carol.multisigAddress,
          carol.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, bob.multisigAddress.keyPair, bob.fundingTxObj.txb.tx.txOuts[0])

        let txVerifier, error
        txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
        error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
        error.should.equal(false)

        should.exist(commitmentTxObj)
        should.exist(commitmentTxObj.txb)
        should.exist(commitmentTxObj.outputList)

        should.exist(commitmentTxObj.outputList[0])
        should.exist(commitmentTxObj.outputList[0].redeemScript)
        should.exist(commitmentTxObj.outputList[0].scriptPubkey)

        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].revocationSecret)
      }, this)
    })

    it('case with one pubKey output and a change output', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = [
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7)),
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7))
        ]
        yield commitmentTxObj.asyncBuild(
          carol.fundingTxObj.txb,
          carol.multisigAddress,
          carol.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, bob.multisigAddress.keyPair, bob.fundingTxObj.txb.tx.txOuts[0])

        let txVerifier, error
        txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
        error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
        // we expect an error here as the transaction is not fully signed
        error.should.equal(false)

        should.exist(commitmentTxObj)
        should.exist(commitmentTxObj.txb)
        should.exist(commitmentTxObj.outputList)

        should.exist(commitmentTxObj.outputList[0])
        should.exist(commitmentTxObj.outputList[0].redeemScript)
        should.exist(commitmentTxObj.outputList[0].scriptPubkey)

        should.exist(commitmentTxObj.outputList[1])
        should.exist(commitmentTxObj.outputList[1].redeemScript)
        should.exist(commitmentTxObj.outputList[1].scriptPubkey)

        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].revocationSecret)
      }, this)
    })

    it('case with one revocable pubKey output and a change output', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = [
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7)),
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7))
        ]
        yield commitmentTxObj.asyncBuild(
          bob.fundingTxObj.txb,
          bob.multisigAddress,
          bob.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, carol.multisigAddress.keyPair, carol.fundingTxObj.txb.tx.txOuts[0])

        let txVerifier, error
        txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
        error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
        // we expect an error here as the transaction is not fully signed
        error.should.equal(false)

        should.exist(commitmentTxObj)
        should.exist(commitmentTxObj.txb)
        should.exist(commitmentTxObj.outputList)

        should.exist(commitmentTxObj.outputList[0])
        should.exist(commitmentTxObj.outputList[0].redeemScript)
        should.exist(commitmentTxObj.outputList[0].scriptPubkey)

        should.exist(commitmentTxObj.outputList[1])
        should.exist(commitmentTxObj.outputList[1].redeemScript)
        should.exist(commitmentTxObj.outputList[1].scriptPubkey)

        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].revocationSecret)
      }, this)
    })

    it('case with one htlc output and a change output', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = [
          new OutputDescription(
            'htlc',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7)),
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7))
        ]
        yield commitmentTxObj.asyncBuild(
          carol.fundingTxObj.txb,
          carol.multisigAddress,
          carol.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, bob.multisigAddress.keyPair, bob.fundingTxObj.txb.tx.txOuts[0])

        let txVerifier, error
        txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
        error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
        // we expect an error here as the transaction is not fully signed
        error.should.equal(false)

        should.exist(commitmentTxObj)
        should.exist(commitmentTxObj.txb)
        should.exist(commitmentTxObj.outputList)

        should.exist(commitmentTxObj.outputList[0])
        should.exist(commitmentTxObj.outputList[0].redeemScript)
        should.exist(commitmentTxObj.outputList[0].scriptPubkey)

        should.exist(commitmentTxObj.outputList[1])
        should.exist(commitmentTxObj.outputList[1].redeemScript)
        should.exist(commitmentTxObj.outputList[1].scriptPubkey)

        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].revocationSecret)
      }, this)
    })

    it('case with one revocable htlc output and a change output', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = [
          new OutputDescription(
            'htlc',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7)),
          new OutputDescription(
            'pubKey',
            'alice', 'bob', 'carol', 'dave',
            'm/1/2', 'm/4/5',
            htlcSecret, revocationSecret,
            Bn(1e7))
        ]
        yield commitmentTxObj.asyncBuild(
          bob.fundingTxObj.txb,
          bob.multisigAddress,
          bob.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, carol.multisigAddress.keyPair, carol.fundingTxObj.txb.tx.txOuts[0])

        let txVerifier, error
        txVerifier = new TxVerifier(commitmentTxObj.txb.tx, commitmentTxObj.txb.uTxOutMap)
        error = txVerifier.verifyStr(Interp.SCRIPT_VERIFY_P2SH | Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY | Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY)
        // we expect an error here as the transaction is not fully signed
        error.should.equal(false)

        should.exist(commitmentTxObj)
        should.exist(commitmentTxObj.txb)
        should.exist(commitmentTxObj.outputList)

        should.exist(commitmentTxObj.outputList[0])
        should.exist(commitmentTxObj.outputList[0].redeemScript)
        should.exist(commitmentTxObj.outputList[0].scriptPubkey)

        should.exist(commitmentTxObj.outputList[1])
        should.exist(commitmentTxObj.outputList[1].redeemScript)
        should.exist(commitmentTxObj.outputList[1].scriptPubkey)

        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(commitmentTxObj.outputList[1].revocationSecret)
      }, this)
    })
  })

  describe('#toJSON', function () {
    it('should create a json object', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = outputList
        yield commitmentTxObj.asyncBuild(
          bob.fundingTxObj.txb,
          bob.multisigAddress,
          bob.id,
          bips)
        yield commitmentTxObj.txb.asyncSign(0, carol.multisigAddress.keyPair, carol.fundingTxObj.txb.tx.txOuts[0])
        let json = commitmentTxObj.toJSON()

        should.exist(json)
        should.exist(json.txb)
        should.exist(json.outputList)

        SecretHelper.checkSecretNotHidden(json.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(json.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(json.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(json.outputList[1].revocationSecret)
      }, this)
    })
  })

  describe('#fromJSON', function () {
    it('should create CommitmentTxObj from a json object', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = outputList
        yield commitmentTxObj.asyncBuild(
          bob.fundingTxObj.txb,
          bob.multisigAddress,
          bob.id,
          bips)

        let json = commitmentTxObj.toJSON()
        let txo = new CommitmentTxObj().fromJSON(json)

        should.exist(txo)
        should.exist(txo.txb)
        should.exist(txo.outputList)

        SecretHelper.checkSecretNotHidden(txo.outputList[0].htlcSecret)
        SecretHelper.checkSecretNotHidden(txo.outputList[0].revocationSecret)
        SecretHelper.checkSecretNotHidden(txo.outputList[1].htlcSecret)
        SecretHelper.checkSecretNotHidden(txo.outputList[1].revocationSecret)
      }, this)
    })
  })

  describe('#toPublic', function () {
    it('should create a public CommitmentTxObj object', function () {
      return asink(function * () {
        let commitmentTxObj = new CommitmentTxObj()
        commitmentTxObj.outputList = outputList
        yield commitmentTxObj.asyncBuild(
          bob.fundingTxObj.txb,
          bob.multisigAddress,
          bob.id,
          bips)
        let txo = commitmentTxObj.toPublic()

        should.exist(txo)
        should.exist(txo.txb)
        should.exist(txo.outputList)

        SecretHelper.checkSecretHidden(txo.outputList[0].htlcSecret)
        SecretHelper.checkSecretHidden(txo.outputList[0].revocationSecret)
        SecretHelper.checkSecretHidden(txo.outputList[1].htlcSecret)
        SecretHelper.checkSecretHidden(txo.outputList[1].revocationSecret)
      }, this)
    })
  })
})
