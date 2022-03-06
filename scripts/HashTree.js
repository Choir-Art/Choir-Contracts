'use strict';

// Imports.
import { ethers } from 'ethers';

/**
  @title A class for representing a binary hash tree of caller addresses with
    associated integer allowances.
  @author 0xthrpw
  @author Tim Clancy

  This class constructs a binary hash tree consisting of leaves that correlate a
  caller to an integer allowance amount. This hash tree mechanism is used in
  restricting whitelist allocations for token sales because its data can be
  reconstructed efficiently on-chain.

  February 23rd, 2022.
*/
export default class HashTree {

  /**
    Expand an object mapping caller addresses to their allowances into an array
    of hash tree leaves ordered by address.

    @param _balances An object where each key is the address of a caller and
    each value is the token allowance granted to that caller.

    @return An array of expanded hash tree leaves ordered by the caller address.
  */
  static expandLeaves (_balances) {
    let addresses = Object.keys(_balances);
    addresses.sort();

    /*
      Map the array of sorted addresses to an expanded format containing their
      allowances.
    */
    return addresses.map(function (address, i) {
      return {
        address: address,
        index: i,
        allowance: _balances[address]
      };
    });
  }

  /**
    Expand all leaves and return an array of Keccak-256 hashes of each leaf
    index, leaf address, and leaf allowance packed into their corresponding data
    types.

    @param _balances An object where each key is the address of a caller and
      each value is the token allowance granted to that caller.

    @return An array of Keccak-256 Solidity-packed leaf data.
  */
  static getLeafHashes (_balances) {
    let leaves = HashTree.expandLeaves(_balances);
    return leaves.map(function (leaf) {
      return ethers.utils.solidityKeccak256(
        [ 'uint256', 'address', 'uint256' ],
        [ leaf.index, leaf.address, leaf.allowance ]
      );
    });
  }

  /**
    Take an array of hashed leaves and mutate it in-place to prune the
    bottom-most layer of the hash tree.

    @param _leaves An array of hashed leaves of the hash tree. Each pair of
      leaves are siblings.
  */
  static pruneBottomLayer (_leaves) {
    let parents = [];

    /*
      So long as there are leaves, iterate pairwise through `_leaves` to
      construct parent node hashes. In the event that only a single leaf
      remains, it is hashed twice to construct its parent.
    */
    while (_leaves.length) {
      let left = _leaves.shift();
      let right = (_leaves.length === 0)
        ? left
        : _leaves.shift();

      // Hash the left and right sibling leaves to create the parent node.
      parents.push(ethers.utils.solidityKeccak256(
        [ 'bytes32', 'bytes32' ],
        [ left, right ]
      ));
    }

    /*
      Push the parent nodes into the drained `_leaves` array. The bottom layer
      of the hash tree has been pruned.
    */
    parents.forEach(function (leaf) {
      _leaves.push(leaf);
    });
  }

  /**
    Compute the root hash of the hash tree by continuously pruning the
    bottom-most layer of the tree as represented by an array of leaf hashes.

    @param _balances An object where each key is the address of a caller and
      each value is the token allowance granted to that caller.

    @return The root hash of the tree that results from processing `_balances`
      as a binary hash tree.
  */
  static computeRootHash (_balances) {
    let leaves = HashTree.getLeafHashes(_balances);
    while (leaves.length > 1) {
      HashTree.pruneBottomLayer(leaves);
    }
    return leaves[0];
  }

  /**
    Compute a proof that may be submitted for validating that the leaf at
    position `_index` of the leaf hash array is a member of the tree constructed
    from `_balances`.

    @param _balances An object where each key is the address of a caller and
      each value is the token allowance granted to that caller.
    @param _index An index in a flattened array of pairwise child leaves used to
      select a specific leaf of the tree.

    @return A proof array containing the hashes of leaves that can reconstruct
      the binary hash tree's root hash given the leaf at `_index`.
  */
  static computeProof (_balances, _index) {
    let leaves = HashTree.getLeafHashes(_balances);
    if (_index == null) {
      throw new Error('The proof index must be non-null.');
    }

    /*
      The given `_index` parameter specifies which leaf of the hash tree we
      begin at when retracing our path towards the tree's root. We iteratively
      prune layers from the tree as we retrace our path back towards the root
      hash, storing the leaves that we must hash with along the way.
    */
    let proof = [];
    let path = _index;
    while (leaves.length > 1) {

      /*
        Our path is currently on the right-hand sibling of a child pair.
        Therefore, we incorporate the left-hand sibling as an element of our
        proof.
      */
      if ((path % 2) == 1) {
        proof.push(leaves[path - 1]);

      /*
        Our path is currently either on the left-hand sibling of a child pair or
        on a lone sibling of tree with an odd number of leaves.
      */
      } else {

        /*
          If a right-hand sibling exists, we incorporate the left-hand sibling
          as an element of our proof.
        */
        if (typeof leaves[path + 1] != 'undefined') {
          proof.push(leaves[path + 1]);

        // Otherwise we are a lone child and incorporate ourself.
        } else {
          proof.push(leaves[path]);
        }
      }

      // Prune the bottom layer of the tree.
      HashTree.pruneBottomLayer(leaves);

      // Move our path up a level of our constructed binary tree.
      path = parseInt(path / 2);
    }

    // Return the proof array.
    return proof;
  }

  /**
    In addition to the static operation of this class as a manager of hash
    trees, we can construct specific instances. This public field variable
    stores a specific object mapping caller addresses to allowances.
  */
  balances;

  // Store the root hash of a specific instance of a hash tree.
  rootHash;

  /**
    Construct a new hash tree for controlling token distribution by providing an
    object mapping caller addresses to their allowances. The `_balances` object
    is expanded into pairwise leaves that are then pruned upwards to compute the
    root hash of the binary hash tree.

    @param _balances An object where each key is the address of a caller and
      each value is the token allowance granted to that caller. Addresses will
      be stored in lowercase.
  */
  constructor (_balances) {
    this.balances = Object.fromEntries(
      Object.entries(_balances).map(
        ([ address, allowance ]) => [ address.toLowerCase(), allowance ]
      )
    );
    this.rootHash = HashTree.computeRootHash(_balances);
  }

  /**
    Retrieve the index of an address in the flattened list of leaf hashes. This
    function throws an error if the address is not in the hash tree or if the
    tree is wrongly constructed.

    @param _address The address of a caller to retrieve an index of.

    @return The index of the address `_address` in the hash tree.

    @throws Error If the hash tree has wrongly-mapped indices.
    @throws Error If `_address` is not found in the hash tree.
  */
  getIndex (_address) {
    let address = _address.toLowerCase();
    let leaves = HashTree.expandLeaves(this.balances);

    // Iterate through all leaves, checking indices and returning any match.
    for (let i = 0; i < leaves.length; i++) {
      if (i != leaves[i].index) {
        throw new Error('The HashTree indices map wrongly.');
      }
      if (leaves[i].address === address) {
        return leaves[i].index;
      }
    }

    // Throw an error if no index is found.
    throw new Error('The HashTree does not include that address.');
  }

  /**
    Retrieve the address of a caller from the hash tree given the index of a
    leaf via `_index`.

    @param _index The index of the leaf to get the address of.

    @return The address of the caller in the leaf `_index`.
  */
  getAddress (_index) {
    let leaves = HashTree.expandLeaves(this.balances);
    return leaves[_index].address;
  }

  /**
    Retrieve the allowance of a caller from the hash tree given the index of a
    leaf via `_index`.

    @param _index The index of the leaf to get the allowance of.

    @return The allowance of the caller in the leaf `_index`.
  */
  getAllowance (_index) {
    let leaves = HashTree.expandLeaves(this.balances);
    return leaves[_index].allowance;
  }

  /**
    Retrieve the proof array for a caller from the hash tree given the index of
    a leaf via `_index`.

    @param _index The index of the leaf to get the proof array for.

    @return The proof array for the caller in the leaf `_index`.
  */
  getProof (_index) {
    return HashTree.computeProof(this.balances, _index);
  }

  /**
    Return a data structure containing the root hash of the hash tree and an
    array of all leaves containing their proofs.

    @return The root hash and leaves of the hash tree.
  */
  getTree () {
    let leaves = HashTree.expandLeaves(this.balances);

    // Embed the proof for each leaf.
    for (let i = 0; i < leaves.length; i++) {
      leaves[i].proof = HashTree.computeProof(this.balances, i)
    }

    // Return the root and leaves of the tree.
    return {
      rootHash: this.rootHash,
      leaves: leaves
    };
  }
}
