import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import type { ERC7984Test, FTESTStaking } from "../types";

describe("FTESTStaking", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let token: ERC7984Test;
  let staking: FTESTStaking;

  const INITIAL_MINT = 100n * 1_000_000n;
  const STAKE_AMOUNT = 50n * 1_000_000n;
  const DAY = 86400;
  const MAX_OPERATOR_UNTIL = (1n << 48n) - 1n;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [deployer, alice] = [signers[0], signers[1]];

    const tokenFactory = await ethers.getContractFactory("ERC7984Test", deployer);
    token = (await tokenFactory.deploy()) as ERC7984Test;
    await token.waitForDeployment();

    const stakingFactory = await ethers.getContractFactory("FTESTStaking", deployer);
    staking = (await stakingFactory.deploy(await token.getAddress())) as FTESTStaking;
    await staking.waitForDeployment();

    await token.connect(alice).mintFree();
    await token.connect(alice).setOperator(await staking.getAddress(), MAX_OPERATOR_UNTIL);
  });

  async function decryptStake(account: HardhatEthersSigner) {
    const stakeInfo = await staking.getStake(await account.getAddress());
    const principalHandle = stakeInfo[0];
    const rewardsHandle = stakeInfo[1];

    const principal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      principalHandle,
      await staking.getAddress(),
      account
    );

    let rewards = 0n;
    if (rewardsHandle !== ethers.ZeroHash) {
      const decryptedRewards = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        rewardsHandle,
        await staking.getAddress(),
        account
      );
      rewards = BigInt(decryptedRewards);
    }

    return { principal: BigInt(principal), rewards, lastAccrued: stakeInfo[2] };
  }

  async function stakeAmount(account: HardhatEthersSigner, amount: bigint) {
    const encrypted = await fhevm
      .createEncryptedInput(await staking.getAddress(), await account.getAddress())
      .add64(amount)
      .encrypt();

    await staking
      .connect(account)
      .stake(encrypted.handles[0], encrypted.inputProof);
  }

  async function decryptBalance(account: HardhatEthersSigner) {
    const balance = await token.confidentialBalanceOf(await account.getAddress());
    const decrypted = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance,
      await token.getAddress(),
      account
    );
    return BigInt(decrypted);
  }

  it("stakes encrypted amounts and updates principal", async function () {
    const initialBalance = await decryptBalance(alice);
    expect(initialBalance).to.equal(INITIAL_MINT);

    await stakeAmount(alice, STAKE_AMOUNT);

    const { principal, rewards } = await decryptStake(alice);
    expect(principal).to.equal(STAKE_AMOUNT);
    expect(rewards).to.equal(0n);

    const balanceAfter = await decryptBalance(alice);
    expect(balanceAfter).to.equal(INITIAL_MINT - STAKE_AMOUNT);
  });

  it("accrues rewards over full days and allows claiming", async function () {
    await stakeAmount(alice, STAKE_AMOUNT);

    await ethers.provider.send("evm_increaseTime", [DAY]);
    await ethers.provider.send("evm_mine", []);

    const balanceBefore = await decryptBalance(alice);
    await expect(staking.connect(alice).claimRewards()).to.emit(staking, "RewardsClaimed");

    const balanceAfter = await decryptBalance(alice);
    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT / 100n);

    const { rewards } = await decryptStake(alice);
    expect(rewards).to.equal(0n);

    await expect(staking.connect(alice).claimRewards()).to.be.revertedWithCustomError(staking, "NoRewards");
  });

  it("supports partial unstake and keeps remaining balance", async function () {
    await stakeAmount(alice, STAKE_AMOUNT);

    const withdrawAmount = 20n * 1_000_000n;
    const encrypted = await fhevm
      .createEncryptedInput(await staking.getAddress(), await alice.getAddress())
      .add64(withdrawAmount)
      .encrypt();

    await staking.connect(alice).unstake(encrypted.handles[0], encrypted.inputProof);

    const { principal } = await decryptStake(alice);
    expect(principal).to.equal(STAKE_AMOUNT - withdrawAmount);

    const balanceAfter = await decryptBalance(alice);
    expect(balanceAfter).to.equal(INITIAL_MINT - (STAKE_AMOUNT - withdrawAmount));
  });
});
