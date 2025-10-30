// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {ERC7984Test} from "./ERC7984Test.sol";

contract NightStaking is SepoliaConfig {
    using FHESafeMath for euint64;

    uint64 private constant RATE_DIVISOR = 100;
    uint64 private constant SECONDS_PER_DAY = 86_400;

    struct StakeInfo {
        euint64 principal;
        euint64 rewards;
        uint64 lastAccrued;
    }

    ERC7984Test public immutable stakingToken;
    mapping(address => StakeInfo) private _stakes;

    event Staked(address indexed account, euint64 amount);
    event Unstaked(address indexed account, euint64 requestedAmount, euint64 withdrawnAmount);
    event RewardsClaimed(address indexed account, euint64 amount);

    error NoRewards();

    constructor(address token) {
        stakingToken = ERC7984Test(token);
    }

    function stake(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        StakeInfo storage info = _stakes[msg.sender];

        _accrueRewards(msg.sender, info);

        euint64 stakeAmount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(stakeAmount, address(stakingToken));

        euint64 transferred = stakingToken.confidentialTransferFrom(msg.sender, address(this), stakeAmount);

        info.principal = FHE.add(info.principal, transferred);
        _syncAccess(info.principal, msg.sender);

        if (info.lastAccrued == 0) {
            info.lastAccrued = uint64(block.timestamp);
        }

        emit Staked(msg.sender, transferred);
    }

    function unstake(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        StakeInfo storage info = _stakes[msg.sender];
        _accrueRewards(msg.sender, info);

        euint64 requestedAmount = FHE.fromExternal(encryptedAmount, inputProof);

        (ebool success, euint64 updatedPrincipal) = info.principal.tryDecrease(requestedAmount);
        info.principal = updatedPrincipal;
        _syncAccess(info.principal, msg.sender);

        euint64 amountToTransfer = FHE.select(success, requestedAmount, FHE.asEuint64(0));
        if (FHE.isInitialized(amountToTransfer)) {
            FHE.allowTransient(amountToTransfer, address(stakingToken));
            stakingToken.confidentialTransfer(msg.sender, amountToTransfer);
        }

        emit Unstaked(msg.sender, requestedAmount, amountToTransfer);
    }

    function claimRewards() external {
        StakeInfo storage info = _stakes[msg.sender];
        _accrueRewards(msg.sender, info);

        if (!FHE.isInitialized(info.rewards)) {
            revert NoRewards();
        }

        euint64 rewardsToSend = info.rewards;
        info.rewards = euint64.wrap(bytes32(0));

        FHE.allowTransient(rewardsToSend, address(stakingToken));
        stakingToken.confidentialTransfer(msg.sender, rewardsToSend);

        emit RewardsClaimed(msg.sender, rewardsToSend);
    }

    function getStake(address account)
        external
        view
        returns (euint64 principal, euint64 rewards, uint64 lastAccrued)
    {
        StakeInfo storage info = _stakes[account];
        return (info.principal, info.rewards, info.lastAccrued);
    }

    function pendingRewards(address account) external returns (euint64) {
        StakeInfo storage info = _stakes[account];
        if (!FHE.isInitialized(info.principal)) {
            return info.rewards;
        }

        uint64 lastAccrued = info.lastAccrued;
        if (lastAccrued == 0 || block.timestamp <= lastAccrued) {
            return info.rewards;
        }

        uint64 elapsedSeconds = uint64(block.timestamp) - lastAccrued;
        uint64 elapsedDays = elapsedSeconds / SECONDS_PER_DAY;
        if (elapsedDays == 0) {
            return info.rewards;
        }

        euint64 accrued = FHE.mul(info.principal, elapsedDays);
        accrued = FHE.div(accrued, RATE_DIVISOR);

        euint64 preview = FHE.add(info.rewards, accrued);
        _syncAccess(preview, account);

        return preview;
    }

    function _accrueRewards(address account, StakeInfo storage info) private {
        if (!FHE.isInitialized(info.principal)) {
            info.lastAccrued = uint64(block.timestamp);
            return;
        }

        uint64 lastAccrued = info.lastAccrued;
        uint64 currentTime = uint64(block.timestamp);

        if (lastAccrued == 0) {
            info.lastAccrued = currentTime;
            return;
        }

        if (currentTime <= lastAccrued) {
            return;
        }

        uint64 elapsedSeconds = currentTime - lastAccrued;
        uint64 elapsedDays = elapsedSeconds / SECONDS_PER_DAY;
        if (elapsedDays == 0) {
            return;
        }

        euint64 accrued = FHE.mul(info.principal, elapsedDays);
        accrued = FHE.div(accrued, RATE_DIVISOR);

        info.rewards = FHE.add(info.rewards, accrued);
        _syncAccess(info.rewards, account);

        info.lastAccrued = lastAccrued + (elapsedDays * SECONDS_PER_DAY);
    }

    function _syncAccess(euint64 value, address account) private {
        if (!FHE.isInitialized(value)) {
            return;
        }

        FHE.allowThis(value);
        if (account != address(0)) {
            FHE.allow(value, account);
        }
    }
}
