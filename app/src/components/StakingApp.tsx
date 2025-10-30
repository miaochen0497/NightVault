import { useCallback, useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, usePublicClient } from 'wagmi';

import {
  FTEST_TOKEN_ADDRESS,
  FTEST_TOKEN_ABI,
  FTEST_STAKING_ADDRESS,
  FTEST_STAKING_ABI,
  TOKEN_DECIMALS,
} from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import '../styles/StakingApp.css';

type FeedbackState = {
  type: 'success' | 'error' | 'warning';
  message: string;
} | null;

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const DECIMALS = BigInt(TOKEN_DECIMALS);
const DECIMAL_FACTOR = 10n ** DECIMALS;
const SECONDS_PER_DAY = 86_400n;

function formatToken(raw: bigint): string {
  const sign = raw < 0n ? '-' : '';
  const value = raw < 0n ? -raw : raw;
  const integer = value / DECIMAL_FACTOR;
  const fraction = value % DECIMAL_FACTOR;
  const fractionString = fraction === 0n ? '' : fraction.toString().padStart(Number(DECIMALS), '0').replace(/0+$/, '');
  return fractionString.length > 0
    ? `${sign}${integer.toString()}.${fractionString}`
    : `${sign}${integer.toString()}`;
}

function parseAmount(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Amount is required');
  }

  if (!/^\d*(\.\d*)?$/.test(trimmed)) {
    throw new Error('Enter a valid number');
  }

  const [integerPart, fractionalPart = ''] = trimmed.split('.');
  const sanitizedInteger = integerPart.length > 0 ? integerPart : '0';

  if (fractionalPart.length > Number(DECIMALS)) {
    throw new Error(`Maximum of ${TOKEN_DECIMALS} decimal places allowed`);
  }

  const paddedFraction = fractionalPart.padEnd(Number(DECIMALS), '0');
  return BigInt(sanitizedInteger) * DECIMAL_FACTOR + BigInt(paddedFraction || '0');
}

function toReadableTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'No accrual recorded yet';
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export function StakingApp() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [stakeInput, setStakeInput] = useState('');
  const [unstakeInput, setUnstakeInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');
  const [lastAccruedAt, setLastAccruedAt] = useState<number | null>(null);

  const [walletRaw, setWalletRaw] = useState<bigint>(0n);
  const [stakedRaw, setStakedRaw] = useState<bigint>(0n);
  const [rewardsRaw, setRewardsRaw] = useState<bigint>(0n);
  const [pendingRaw, setPendingRaw] = useState<bigint>(0n);

  const canInteract = useMemo(() => isConnected && !!address && !!instance && !!signerPromise, [address, instance, isConnected, signerPromise]);

  const resetFeedback = () => setFeedback(null);

  const refreshBalances = useCallback(async () => {
    if (!address || !publicClient || !instance) {
      return;
    }

    if (!signerPromise) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to decrypt balances.' });
      return;
    }

    setIsRefreshing(true);
    resetFeedback();

    try {
      const [stakeData, walletHandle] = await Promise.all([
        publicClient.readContract({
          address: FTEST_STAKING_ADDRESS,
          abi: FTEST_STAKING_ABI,
          functionName: 'getStake',
          args: [address],
        }),
        publicClient.readContract({
          address: FTEST_TOKEN_ADDRESS,
          abi: FTEST_TOKEN_ABI,
          functionName: 'confidentialBalanceOf',
          args: [address],
        }),
      ]);

      const [principalHandle, rewardsHandle, lastAccrued] = stakeData as readonly [string, string, bigint];

      const handlePairs: Array<{ handle: string; contractAddress: string }> = [];
      const handleLookup = new Map<string, 'principal' | 'rewards' | 'wallet'>();

      if (principalHandle !== ZERO_BYTES32) {
        handlePairs.push({ handle: principalHandle, contractAddress: FTEST_STAKING_ADDRESS });
        handleLookup.set(principalHandle, 'principal');
      }

      if (rewardsHandle !== ZERO_BYTES32) {
        handlePairs.push({ handle: rewardsHandle, contractAddress: FTEST_STAKING_ADDRESS });
        handleLookup.set(rewardsHandle, 'rewards');
      }

      if (walletHandle !== ZERO_BYTES32) {
        handlePairs.push({ handle: walletHandle as string, contractAddress: FTEST_TOKEN_ADDRESS });
        handleLookup.set(walletHandle as string, 'wallet');
      }

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer not available. Please reconnect your wallet.');
      }

      const decryptedValues: Record<string, string> = {};

      if (handlePairs.length > 0) {
        const keypair = instance.generateKeypair();
        const startTimestamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = '10';
        const contractAddresses = Array.from(new Set(handlePairs.map((item) => item.contractAddress)));

        const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
        const signature = await signer.signTypedData(
          eip712.domain,
          { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
          eip712.message,
        );

        const result = await instance.userDecrypt(
          handlePairs,
          keypair.privateKey,
          keypair.publicKey,
          signature.replace('0x', ''),
          contractAddresses,
          address,
          startTimestamp,
          durationDays,
        );

        Object.assign(decryptedValues, result);
      }

      const principalRaw = handleLookup.has(principalHandle)
        ? BigInt(decryptedValues[principalHandle as string] ?? '0')
        : 0n;
      const rewardsRawValue = handleLookup.has(rewardsHandle)
        ? BigInt(decryptedValues[rewardsHandle as string] ?? '0')
        : 0n;
      const walletRawValue = handleLookup.has(walletHandle as string)
        ? BigInt(decryptedValues[walletHandle as string] ?? '0')
        : 0n;

      const lastAccruedNumber = Number(lastAccrued);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const elapsedSeconds = lastAccruedNumber > 0 ? now - BigInt(lastAccruedNumber) : 0n;
      const elapsedDays = elapsedSeconds / SECONDS_PER_DAY;
      const additionalRewards = elapsedDays > 0n ? (principalRaw * elapsedDays) / 100n : 0n;
      const pendingValue = rewardsRawValue + additionalRewards;

      setWalletRaw(walletRawValue);
      setStakedRaw(principalRaw);
      setRewardsRaw(rewardsRawValue);
      setPendingRaw(pendingValue);
      setLastAccruedAt(lastAccruedNumber > 0 ? lastAccruedNumber : null);
      setLastSyncedAt(new Date().toLocaleTimeString());

      setFeedback({ type: 'success', message: 'Balances refreshed.' });
    } catch (error) {
      console.error('Failed to refresh balances', error);
      const message = error instanceof Error ? error.message : 'Unknown error while refreshing balances';
      setFeedback({ type: 'error', message });
    } finally {
      setIsRefreshing(false);
    }
  }, [address, instance, publicClient, signerPromise]);

  useEffect(() => {
    if (canInteract && !isRefreshing) {
      refreshBalances();
    }
  }, [canInteract, isRefreshing, refreshBalances]);

  const formatDisplay = useCallback((raw: bigint) => formatToken(raw), []);

  const handleMint = useCallback(async () => {
    if (!canInteract || !signerPromise) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to mint tokens.' });
      return;
    }

    resetFeedback();
    setActiveAction('mint');

    try {
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer is unavailable.');
      }

      const token = new Contract(FTEST_TOKEN_ADDRESS, FTEST_TOKEN_ABI, signer);
      const tx = await token.mintFree();
      await tx.wait();
      setFeedback({ type: 'success', message: 'Minted 100 fTEST successfully.' });
      await refreshBalances();
    } catch (error) {
      console.error('Mint failed', error);
      const message = error instanceof Error ? error.message : 'Minting failed';
      setFeedback({ type: 'error', message });
    } finally {
      setActiveAction(null);
    }
  }, [canInteract, refreshBalances, signerPromise]);

  const handleAuthorize = useCallback(async () => {
    if (!canInteract || !signerPromise) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to set the operator.' });
      return;
    }

    resetFeedback();
    setActiveAction('authorize');

    try {
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer is unavailable.');
      }

      const token = new Contract(FTEST_TOKEN_ADDRESS, FTEST_TOKEN_ABI, signer);
      const until = BigInt(Math.floor(Date.now() / 1000)) + 365n * SECONDS_PER_DAY;
      const tx = await token.setOperator(FTEST_STAKING_ADDRESS, until);
      await tx.wait();
      setFeedback({ type: 'success', message: 'Staking contract authorized for transfers.' });
    } catch (error) {
      console.error('Authorization failed', error);
      const message = error instanceof Error ? error.message : 'Failed to set operator';
      setFeedback({ type: 'error', message });
    } finally {
      setActiveAction(null);
    }
  }, [canInteract, signerPromise]);

  const handleStake = useCallback(async () => {
    if (!canInteract || !signerPromise || !instance) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to stake fTEST.' });
      return;
    }

    resetFeedback();

    try {
      const rawAmount = parseAmount(stakeInput);
      if (rawAmount === 0n) {
        throw new Error('Stake amount must be greater than zero.');
      }
      if (rawAmount > walletRaw) {
        throw new Error('Insufficient wallet balance.');
      }

      setActiveAction('stake');

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer is unavailable.');
      }

      const buffer = instance.createEncryptedInput(FTEST_STAKING_ADDRESS, address!);
      buffer.add64(rawAmount);
      const encrypted = await buffer.encrypt();

      const stakingContract = new Contract(FTEST_STAKING_ADDRESS, FTEST_STAKING_ABI, signer);
      const tx = await stakingContract.stake(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();

      setFeedback({ type: 'success', message: 'Stake submitted successfully.' });
      setStakeInput('');
      await refreshBalances();
    } catch (error) {
      console.error('Stake failed', error);
      const message = error instanceof Error ? error.message : 'Staking failed';
      setFeedback({ type: 'error', message });
    } finally {
      setActiveAction(null);
    }
  }, [address, canInteract, instance, refreshBalances, signerPromise, stakeInput, walletRaw]);

  const handleUnstake = useCallback(async () => {
    if (!canInteract || !signerPromise || !instance) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to unstake.' });
      return;
    }

    resetFeedback();

    try {
      const rawAmount = parseAmount(unstakeInput);
      if (rawAmount === 0n) {
        throw new Error('Unstake amount must be greater than zero.');
      }
      if (rawAmount > stakedRaw) {
        throw new Error('You cannot unstake more than your deposited amount.');
      }

      setActiveAction('unstake');

      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer is unavailable.');
      }

      const buffer = instance.createEncryptedInput(FTEST_STAKING_ADDRESS, address!);
      buffer.add64(rawAmount);
      const encrypted = await buffer.encrypt();

      const stakingContract = new Contract(FTEST_STAKING_ADDRESS, FTEST_STAKING_ABI, signer);
      const tx = await stakingContract.unstake(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();

      setFeedback({ type: 'success', message: 'Unstake transaction confirmed.' });
      setUnstakeInput('');
      await refreshBalances();
    } catch (error) {
      console.error('Unstake failed', error);
      const message = error instanceof Error ? error.message : 'Unstaking failed';
      setFeedback({ type: 'error', message });
    } finally {
      setActiveAction(null);
    }
  }, [address, canInteract, instance, refreshBalances, signerPromise, stakedRaw, unstakeInput]);

  const handleClaim = useCallback(async () => {
    if (!canInteract || !signerPromise) {
      setFeedback({ type: 'warning', message: 'Connect your wallet to claim rewards.' });
      return;
    }

    if (pendingRaw === 0n) {
      setFeedback({ type: 'warning', message: 'No rewards available to claim.' });
      return;
    }

    resetFeedback();
    setActiveAction('claim');

    try {
      const signer = await signerPromise;
      if (!signer) {
        throw new Error('Wallet signer is unavailable.');
      }

      const stakingContract = new Contract(FTEST_STAKING_ADDRESS, FTEST_STAKING_ABI, signer);
      const tx = await stakingContract.claimRewards();
      await tx.wait();

      setFeedback({ type: 'success', message: 'Rewards claimed successfully.' });
      await refreshBalances();
    } catch (error) {
      console.error('Claim failed', error);
      const message = error instanceof Error ? error.message : 'Failed to claim rewards';
      setFeedback({ type: 'error', message });
    } finally {
      setActiveAction(null);
    }
  }, [canInteract, pendingRaw, refreshBalances, signerPromise]);

  if (!isConnected) {
    return (
      <div className="staking-app">
        <div className="staking-header">
          <h2 className="staking-title">Private staking</h2>
          <p className="staking-subtitle">Connect your wallet to mint, stake, and harvest confidential yield.</p>
        </div>
        <div className="feedback-message feedback-warning">
          Please connect your wallet using the button in the header to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="staking-app">
      <div className="staking-header">
        <div className="refresh-row">
          <div>
            <h2 className="staking-title">fTEST staking dashboard</h2>
            <p className="staking-subtitle">Stake to earn 1% daily interest, paid in fTEST.</p>
          </div>
          <button
            type="button"
            className="action-button refresh-button"
            onClick={refreshBalances}
            disabled={isRefreshing || activeAction !== null || zamaLoading}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <span className="timestamp">Last accrual update: {toReadableTimestamp(lastAccruedAt)}</span>
        {lastSyncedAt && <span className="status-tag">Synced at {lastSyncedAt}</span>}
        {zamaError && <span className="feedback-message feedback-error">{zamaError}</span>}
      </div>

      {feedback && (
        <div
          className={`feedback-message ${
            feedback.type === 'success'
              ? 'feedback-success'
              : feedback.type === 'error'
              ? 'feedback-error'
              : 'feedback-warning'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <section className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Wallet balance</span>
          <span className="metric-value">{formatDisplay(walletRaw)} fTEST</span>
          <span className="metric-footnote">Tokens available to stake</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Staked principal</span>
          <span className="metric-value">{formatDisplay(stakedRaw)} fTEST</span>
          <span className="metric-footnote">Currently deposited in NightVault</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Accrued rewards</span>
          <span className="metric-value">{formatDisplay(rewardsRaw)} fTEST</span>
          <span className="metric-footnote">Ready to claim now</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Projected claim</span>
          <span className="metric-value">{formatDisplay(pendingRaw)} fTEST</span>
          <span className="metric-footnote">Includes earned interest for completed days</span>
        </div>
      </section>

      <section className="actions-grid">
        <div className="action-card">
          <div>
            <h3 className="action-title">Mint starter balance</h3>
            <p className="action-description">Claim a free allocation of 100 fTEST to experiment with the protocol.</p>
          </div>
          <button
            type="button"
            className="action-button"
            onClick={handleMint}
            disabled={activeAction === 'mint' || zamaLoading}
          >
            {activeAction === 'mint' ? 'Minting…' : 'Mint 100 fTEST'}
          </button>
        </div>

        <div className="action-card">
          <div>
            <h3 className="action-title">Authorize staking</h3>
            <p className="action-description">
              Allow the staking contract to move your encrypted fTEST while you are staked.
            </p>
          </div>
          <button
            type="button"
            className="action-button secondary-button"
            onClick={handleAuthorize}
            disabled={activeAction === 'authorize' || zamaLoading}
          >
            {activeAction === 'authorize' ? 'Authorizing…' : 'Approve NightVault'}
          </button>
        </div>

        <div className="action-card">
          <div className="action-header">
            <h3 className="action-title">Stake fTEST</h3>
            <p className="action-description">Encrypt the amount you want to deposit and start earning immediately.</p>
          </div>
          <div className="action-input-group">
            <input
              type="text"
              className="token-input"
              value={stakeInput}
              onChange={(event) => setStakeInput(event.target.value)}
              placeholder="Amount (e.g. 25.5)"
            />
            <p className="helper-text">Available: {formatDisplay(walletRaw)} fTEST</p>
          </div>
          <div className="action-footer">
            <button
              type="button"
              className="action-button"
              onClick={handleStake}
              disabled={activeAction === 'stake' || zamaLoading}
            >
              {activeAction === 'stake' ? 'Submitting…' : 'Stake now'}
            </button>
          </div>
        </div>

        <div className="action-card">
          <div className="action-header">
            <h3 className="action-title">Unstake funds</h3>
            <p className="action-description">Withdraw part of your encrypted principal without touching rewards.</p>
          </div>
          <div className="action-input-group">
            <input
              type="text"
              className="token-input"
              value={unstakeInput}
              onChange={(event) => setUnstakeInput(event.target.value)}
              placeholder="Amount to unstake"
            />
            <p className="helper-text">Deposited: {formatDisplay(stakedRaw)} fTEST</p>
          </div>
          <button
            type="button"
            className="action-button secondary-button"
            onClick={handleUnstake}
            disabled={activeAction === 'unstake' || zamaLoading}
          >
            {activeAction === 'unstake' ? 'Processing…' : 'Unstake'}
          </button>
        </div>

        <div className="action-card">
          <div>
            <h3 className="action-title">Claim rewards</h3>
            <p className="action-description">Collect accrued interest at any time. Interest compounds once per full day.</p>
          </div>
          <p className="helper-text">Claimable now: {formatDisplay(pendingRaw)} fTEST</p>
          <button
            type="button"
            className="action-button danger-button"
            onClick={handleClaim}
            disabled={activeAction === 'claim' || pendingRaw === 0n || zamaLoading}
          >
            {activeAction === 'claim' ? 'Claiming…' : 'Claim rewards'}
          </button>
        </div>
      </section>
    </div>
  );
}
