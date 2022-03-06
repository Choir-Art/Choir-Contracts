'use strict';

// Imports.
import { ethers } from 'hardhat';
import { expect } from 'chai';

/**
  Describe the contract testing suite, retrieve testing wallets, and create
  contract factories from the artifacts we are testing.
*/
describe('Tiny721', function() {
  let alice, bob, carol, dev;
  let Tiny721, MockERC721Receiver;
  before(async () => {
    const signers = await ethers.getSigners();
    const addresses = await Promise.all(signers.map(async signer => signer.getAddress()));
    alice = { provider: signers[0].provider, signer: signers[0], address: addresses[0] };
    bob = { provider: signers[1].provider, signer: signers[1], address: addresses[1] };
    carol = { provider: signers[2].provider, signer: signers[2], address: addresses[2] };
    dev = { provider: signers[3].provider, signer: signers[3], address: addresses[3] };

    Tiny721 = await ethers.getContractFactory('Tiny721');
    MockERC721Receiver = await ethers.getContractFactory('MockERC721Receiver');
  });

  // Deploy a fresh set of smart contracts, using these constants, for testing.
  const NAME = 'Test';
  const SYMBOL = 'TEST';
  const METADATA_URI = '';
  const CAP = 10420;
  let tiny721, goodReceiver, badReceiver;
  beforeEach(async () => {

    // Deploy an instance of the Tiny721 ERC-721 item contract.
    tiny721 = await Tiny721.connect(alice.signer).deploy(
      NAME,
      SYMBOL,
      METADATA_URI,
      CAP
    );
    await tiny721.deployed();

    // Deploy a mock ERC-721 item receiving contract that can receive items.
    goodReceiver = await MockERC721Receiver.connect(alice.signer).deploy(true);
    await goodReceiver.deployed();

    // Deploy a mock ERC-721 item receiving contract that cannot receive items.
    badReceiver = await MockERC721Receiver.connect(alice.signer).deploy(false);
    await badReceiver.deployed();
  });

  // Confirm that the item's total supply is zero before any minting.
  context('with no minted tokens', async function() {
    it('has 0 totalSupply', async function() {
      const supply = await tiny721.totalSupply();
      supply.should.be.equal(0);
    });
  });

  // Perform those tests utilizing minted tokens.
  context('with minted tokens', async function() {
    beforeEach(async function() {
      await tiny721.connect(alice.signer).mint_Qgo(alice.address, 1);
      await tiny721.connect(alice.signer).mint_Qgo(bob.address, 2);
      await tiny721.connect(alice.signer).mint_Qgo(carol.address, 3);
    });

    // Confirm that we can retrieve balance of holder tokens.
    describe('balanceOf', async function() {
      it('returns the amount for a given address', async function() {
        let aliceBalance = await tiny721.connect(alice.signer).balanceOf(
          alice.address);
        let bobBalance = await tiny721.connect(alice.signer).balanceOf(
          bob.address);
        let carolBalance = await tiny721.connect(alice.signer).balanceOf(
          carol.address);
        let devBalance = await tiny721.connect(alice.signer).balanceOf(
          dev.address);
        let zeroBalance = await tiny721.connect(alice.signer).balanceOf(
          ethers.constants.AddressZero);
        aliceBalance.should.be.equal(1);
        bobBalance.should.be.equal(2);
        carolBalance.should.be.equal(3);
        devBalance.should.be.equal(0);
        zeroBalance.should.be.equal(0);
      });
    });

    // Confirm that ownership is correctly tracked.
    describe('ownerOf', async function() {
      it('returns the right owner', async function() {
        let ownerOne = await tiny721.connect(alice.signer).ownerOf(1);
        ownerOne.should.be.equal(alice.address);
        let ownerTwo = await tiny721.connect(alice.signer).ownerOf(2);
        ownerTwo.should.be.equal(bob.address);
        let ownerFour = await tiny721.connect(alice.signer).ownerOf(4);
        ownerFour.should.be.equal(carol.address);
      });

      // Because the zero address is a valid owner, we would like `ownerOf` to
      // revert on invalid tokens.
      it('reverts for an invalid token', async function() {
        await expect(
          tiny721.connect(alice.signer).ownerOf(0)
        ).to.be.revertedWith('OwnerQueryForNonexistentToken');
        await expect(
          tiny721.connect(alice.signer).ownerOf(7)
        ).to.be.revertedWith('OwnerQueryForNonexistentToken');
      });
    });

    // Confirm that token transfer approvals are correct.
    describe('approve', async function() {
      it('sets approval for the target address', async function() {
        await tiny721.connect(alice.signer).approve(bob.address, 1);
        const approval = await tiny721.connect(alice.signer).getApproved(1);
        approval.should.be.equal(bob.address);
        let ownerOne = await tiny721.connect(alice.signer).ownerOf(1);
        ownerOne.should.be.equal(alice.address);
        await tiny721.connect(bob.signer).transferFrom(alice.address,
          bob.address, 1);
        ownerOne = await tiny721.connect(alice.signer).ownerOf(1);
        ownerOne.should.be.equal(bob.address);
      });

      // Do not allow token approvals to be set by non-owners.
      it('rejects an unapproved caller', async function() {
        await expect(
          tiny721.connect(bob.signer).approve(bob.address, 1)
        ).to.be.revertedWith('ApprovalCallerNotOwnerNorApproved');
      });

      // Do not allow transfer approvals on token IDs that do not exist.
      it('does not get approved for invalid tokens', async function() {
        await expect(
          tiny721.connect(alice.signer).getApproved(7)
        ).to.be.revertedWith('ApprovalQueryForNonexistentToken');
      });
    });

    // Confirm that operator approval can be set correctly.
    describe('setApprovalForAll', async function() {
      it('sets approval for all properly', async function() {
        const approvalTx = await tiny721.connect(alice.signer)
          .setApprovalForAll(bob.address, true);
        await expect(approvalTx)
          .to.emit(tiny721, 'ApprovalForAll')
          .withArgs(alice.address, bob.address, true);
        let isBobApproved = await tiny721.isApprovedForAll(alice.address,
          bob.address);
        isBobApproved.should.be.equal(true);
        let ownerOne = await tiny721.connect(alice.signer).ownerOf(1);
        ownerOne.should.be.equal(alice.address);
        await tiny721.connect(bob.signer).transferFrom(alice.address,
          bob.address, 1);
        ownerOne = await tiny721.connect(alice.signer).ownerOf(1);
        ownerOne.should.be.equal(bob.address);
      });
    });

    // Test both safe and unsafe transfer correctness on this item.
    context('test transfer functionality', async function() {

      /*
        Create a set of test cases that are common to `transferFrom`,
        `safeTransferFrom` with data, and `safeTransferFrom` without data.
      */
      const testTransfer = async function(functionSignature) {
        let args, transfer;
        beforeEach(async function() {
          await tiny721.connect(alice.signer).setApprovalForAll(carol.address,
            true);
          const argumentsLookup = {
            'transferFrom': [alice.address, bob.address, 1],
            'safeTransferFrom(address,address,uint256)': [
              alice.address, bob.address, 1
            ],
            'safeTransferFrom(address,address,uint256,bytes)': [
              alice.address, bob.address, 1, []
            ]
          };
          args = argumentsLookup[functionSignature];
          transfer = await tiny721.connect(alice.signer)[functionSignature]
            .apply(this, args);
        });

        // Confirm that balances appropriately reflect the transfer happening.
        it('adjusts owners balances', async function() {
          let aliceBalance = await tiny721.connect(alice.signer)
            .balanceOf(alice.address);
          let bobBalance = await tiny721.connect(alice.signer)
            .balanceOf(bob.address);
          aliceBalance.should.be.equal(0);
          bobBalance.should.be.equal(3);
        });

        // Confirm that the token ownership changes during transer.
        it('transfers the ownership of the given token ID to the given address', async function() {
          let tokenOwner = await tiny721.connect(alice.signer).ownerOf(1);
          tokenOwner.should.be.equal(bob.address);
        });

        // Any token approval that ALice may have set should be cleared.
        it('clears the approval for the token ID', async function() {
          let tokenApproval = await tiny721.connect(alice.signer)
            .getApproved(1);
          tokenApproval.should.be.equal(ethers.constants.AddressZero);
        });

        // Confirm that the appropriate Transfer event is emitted.
        it('emits the correct Transfer event', async function() {
          await expect(transfer).to
            .emit(tiny721, 'Transfer')
            .withArgs(alice.address, bob.address, 1);
        });

        // Confirm that the appropriate Approval event is emitted.
        it('emits the correct Approval event', async function() {
          await expect(transfer).to
            .emit(tiny721, 'Approval')
            .withArgs(alice.address, ethers.constants.AddressZero, 1);
        });

        /*
          Reject all transfers that do not come from a token owner, approved
          token caller, or approved operator.
        */
        it('rejects unapproved transfer', async function() {
          await expect(
            tiny721.connect(alice.signer)[functionSignature]
              .apply(this, args)
          ).to.be.revertedWith('TransferCallerNotOwnerNorApproved');
        });

        /*
          Reject transfers where an operator tries to move a token unowned by
          their delegator.
        */
        it('reject transfer from operator for unowned id', async function() {
          args[2] += 1;
          await expect(
            tiny721.connect(carol.signer)[functionSignature]
              .apply(this, args)
          ).to.be.revertedWith('TransferCallerNotOwnerNorApproved');
        });

        // Reject transfers of your own tokens from invalid owners.
        it('rejects transfer from incorrect owner', async function() {
          await expect(
            tiny721.connect(bob.signer)[functionSignature]
              .apply(this, args)
          ).to.be.revertedWith('TransferFromIncorrectOwner');
        });

        /*
          The item contract does must not support burning (token ownership by
          the zero address) due to the sparse ownership list gas optimization.
        */
        it('rejects transfer to zero address', async function() {
          args[0] = bob.address;
          args[1] = ethers.constants.AddressZero;
          args[2] = 2;
          await expect(
            tiny721.connect(bob.signer)[functionSignature].apply(this, args)
          ).to.be.revertedWith('TransferToZeroAddress');
        });

        /*
          In the event of a safe transfer, confirm that the ERC-721 receiver
          magic value is returned.
        */
        if (functionSignature.startsWith('safe')) {
          it('validates ERC721Received on safe transfers', async function() {
            args[0] = bob.address;
            args[1] = goodReceiver.address;
            args[2] = 2;
            let safeTransfer = await tiny721.connect(bob.signer)[functionSignature].apply(this, args);
            await expect(safeTransfer).to
              .emit(goodReceiver, 'Received')
              .withArgs(bob.address, bob.address, 2, '0x');
          });

          // Test for a failure to safely transfer to a bad receiver.
          it('validates failed ERC721Received on bad safe transfers', async function() {
            args[0] = bob.address;
            args[1] = badReceiver.address;
            args[2] = 2;
            await expect(
              tiny721.connect(bob.signer)[functionSignature].apply(this, args)
            ).to.be.revertedWith('TransferToNonERC721ReceiverImplementer');
          });
        }
      };

      // Test the non-receiver-checking unsafe `transferFrom`.
      describe('transferFrom', async function() {
        await testTransfer('transferFrom');
      });

      // Test the receiver-checking `safeTransferFrom`.
      describe('safeTransferFrom', async function() {
        await testTransfer('safeTransferFrom(address,address,uint256)');
      });

      // Test `safeTransferFrom` with passing data.
      describe('safeTransferFrom with data', async function() {
        await testTransfer('safeTransferFrom(address,address,uint256,bytes)');
      });
    });
  });

  // Test minting tokens.
  context('mint', async function() {
    it('successfully mints a single token', async function() {
      const mint = await tiny721.mint_Qgo(alice.address, 1);
      await expect(mint).to
        .emit(tiny721, 'Transfer')
        .withArgs(ethers.constants.AddressZero, alice.address, 1);
      await expect(mint).to.not
        .emit(goodReceiver, 'Received');
      let newOwner = await tiny721.ownerOf(1);
      newOwner.should.be.equal(alice.address);
    });

    it('successfully mints multiple tokens', async function() {
      const mint = await tiny721.mint_Qgo(alice.address, 5);
      for (let tokenId = 0; tokenId < 5; tokenId++) {
        await expect(mint).to
          .emit(tiny721, 'Transfer')
          .withArgs(ethers.constants.AddressZero, alice.address, 1 + tokenId);
        await expect(mint).to.not
          .emit(goodReceiver, 'Received');
        let newOwner = await tiny721.ownerOf(1 + tokenId);
        newOwner.should.be.equal(alice.address);
      }
    });

    it('does not revert for non-receivers', async function() {
      await tiny721.mint_Qgo(tiny721.address, 1);
      let ownerOne = await tiny721.ownerOf(1);
      ownerOne.should.be.equal(tiny721.address);
    });

    it('rejects mints to the zero address', async function() {
      await expect(
        tiny721.connect(alice.signer).mint_Qgo(ethers.constants.AddressZero, 1)
      ).to.be.revertedWith('MintToZeroAddress');
    });

    it('requires quantity to be greater than 0', async function() {
      await expect(
        tiny721.connect(alice.signer).mint_Qgo(alice.address, 0)
      ).to.be.revertedWith('MintZeroQuantity');
    });
  });
});
