const Bytes = require("./bytes");
const Nat = require("./nat");
const elliptic = require("elliptic");
const rlp = require("./rlp");
const secp256k1 = new (elliptic.ec)("secp256k1"); // eslint-disable-line
const {keccak256, keccak256s} = require("./keccak");

const create = entropy => {
  const innerHex = keccak256(Bytes.concat(Bytes.random(32), entropy || Bytes.random(32)));
  const middleHex = Bytes.concat(Bytes.concat(Bytes.random(32), innerHex), Bytes.random(32));
  const outerHex = keccak256(middleHex);
  return fromPrivate(outerHex);
}

const toChecksum = address => {
  const addressHash = keccak256s(address.slice(2));
  let checksumAddress = "0x";
  for (let i = 0; i < 40; i++)
    checksumAddress += parseInt(addressHash[i + 2], 16) > 7
      ? address[i + 2].toUpperCase()
      : address[i + 2];
  return checksumAddress;
}

const fromPrivate = privateKey => {
  const buffer = new Buffer(privateKey.slice(2), "hex");
  const ecKey = secp256k1.keyFromPrivate(buffer);
  const publicKey = "0x" + ecKey.getPublic(false, 'hex').slice(2);
  const publicHash = keccak256(publicKey);
  const address = toChecksum("0x" + publicHash.slice(-40));
  return {
    address: address,
    privateKey: privateKey
  }
}

const sign = (data, privateKey, chainId) => {
  const hash = keccak256(data);
  const signature = secp256k1
    .keyFromPrivate(new Buffer(privateKey.slice(2), "hex"))
    .sign(new Buffer(hash.slice(2), "hex"), {canonical: true});
  return rlp.encode([
    Bytes.fromNumber((Nat.toNumber(chainId || "0x1") || 1) * 2 + 35 + signature.recoveryParam),
    Bytes.fromNat("0x" + signature.r.toString(16)),
    Bytes.fromNat("0x" + signature.s.toString(16))
  ]);
};

const recover = (data, signature) => {
  const hash = keccak256(data);
  const vals = rlp.decode(signature);
  const vrs = {v: Bytes.toNumber(vals[0]), r:vals[1].slice(2), s:vals[2].slice(2)};
  const ecPublicKey = secp256k1.recoverPubKey(new Buffer(hash.slice(2), "hex"), vrs, 1 - (vrs.v % 2));
  const publicKey = "0x" + ecPublicKey.encode("hex", false).slice(2);
  const publicHash = keccak256(publicKey);
  const address = toChecksum("0x" + publicHash.slice(-40));
  return address;
};

const transactionSigningData = tx =>
  rlp.encode([
    Bytes.fromNat(tx.nonce),
    Bytes.fromNat(tx.gasPrice),
    Bytes.fromNat(tx.gasLimit),
    tx.to.toLowerCase(),
    Bytes.fromNat(tx.value),
    tx.data,
    Bytes.fromNat(tx.chainId || "0x1"),
    "0x",
    "0x"]);

const signTransaction = (tx, privateKey) => {
  const signingData = transactionSigningData(tx);
  const signature = sign(signingData, privateKey, tx.chainId);
  const rawTransaction = rlp.decode(signingData).slice(0,6).concat(rlp.decode(signature));
  return rlp.encode(rawTransaction);
};

const recoverTransaction = (rawTransaction) => {
  const values = rlp.decode(rawTransaction);
  const signature = rlp.encode(values.slice(6,9));
  const recovery = Bytes.toNumber(values[6]);
  const extraData = recovery < 35 ? [] : [Bytes.fromNumber((recovery - 35) >> 1), "0x", "0x"]
  const signingData = values.slice(0,6).concat(extraData);
  const signingDataHex = rlp.encode(signingData);
  return recover(signingDataHex, signature);
}

module.exports = { 
  create,
  toChecksum,
  fromPrivate,
  sign,
  recover,
  signTransaction,
  recoverTransaction,
  transactionSigningData
}