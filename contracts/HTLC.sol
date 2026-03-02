// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HTLC — Hash Time-Locked Contract for AFOS IntercomSwap
 *
 * Supports both native ETH and ERC-20 token atomic swaps.
 *
 * Flow:
 *   1. Initiator calls lock() with secretHash, recipient, timelock, and ETH value (or ERC-20 amount).
 *   2. Counterparty calls redeem() with the preimage secret before timelock expires.
 *   3. If counterparty never redeems, initiator calls refund() after timelock to recover funds.
 *
 * Security:
 *   - secretHash = keccak256(abi.encodePacked(secret))
 *   - Reentrancy protection via status flag (no re-entrancy guard library needed for this pattern)
 *   - Timelock is an absolute Unix timestamp (block.timestamp)
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract HTLC {
    // ─── Events ───────────────────────────────────────────────────────────────

    event Locked(
        bytes32 indexed contractId,
        address indexed initiator,
        address indexed recipient,
        address token,        // address(0) for native ETH
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );

    event Redeemed(
        bytes32 indexed contractId,
        bytes32 secret
    );

    event Refunded(
        bytes32 indexed contractId
    );

    // ─── State ────────────────────────────────────────────────────────────────

    enum Status { INVALID, LOCKED, REDEEMED, REFUNDED }

    struct HTLCContract {
        address initiator;
        address recipient;
        address token;       // address(0) = native ETH
        uint256 amount;
        bytes32 secretHash;
        uint256 timelock;    // Unix timestamp
        Status  status;
    }

    mapping(bytes32 => HTLCContract) public contracts;

    // ─── Lock ─────────────────────────────────────────────────────────────────

    /**
     * @notice Lock native ETH in a new HTLC.
     * @param secretHash  keccak256(abi.encodePacked(secret))
     * @param recipient   Address that can redeem by revealing the secret
     * @param timelock    Unix timestamp after which initiator can refund
     * @return contractId Unique identifier for this HTLC
     */
    function lockETH(
        bytes32 secretHash,
        address recipient,
        uint256 timelock
    ) external payable returns (bytes32 contractId) {
        require(msg.value > 0,            "HTLC: zero ETH");
        require(recipient != address(0),  "HTLC: zero recipient");
        require(timelock > block.timestamp, "HTLC: timelock in past");

        contractId = keccak256(abi.encodePacked(
            msg.sender, recipient, address(0), msg.value, secretHash, timelock
        ));
        require(contracts[contractId].status == Status.INVALID, "HTLC: duplicate");

        contracts[contractId] = HTLCContract({
            initiator:  msg.sender,
            recipient:  recipient,
            token:      address(0),
            amount:     msg.value,
            secretHash: secretHash,
            timelock:   timelock,
            status:     Status.LOCKED
        });

        emit Locked(contractId, msg.sender, recipient, address(0), msg.value, secretHash, timelock);
    }

    /**
     * @notice Lock ERC-20 tokens in a new HTLC.
     * @param token       ERC-20 token contract address
     * @param amount      Token amount (in token's smallest unit)
     * @param secretHash  keccak256(abi.encodePacked(secret))
     * @param recipient   Address that can redeem by revealing the secret
     * @param timelock    Unix timestamp after which initiator can refund
     * @return contractId Unique identifier for this HTLC
     */
    function lockToken(
        address token,
        uint256 amount,
        bytes32 secretHash,
        address recipient,
        uint256 timelock
    ) external returns (bytes32 contractId) {
        require(token != address(0),      "HTLC: zero token");
        require(amount > 0,               "HTLC: zero amount");
        require(recipient != address(0),  "HTLC: zero recipient");
        require(timelock > block.timestamp, "HTLC: timelock in past");

        contractId = keccak256(abi.encodePacked(
            msg.sender, recipient, token, amount, secretHash, timelock
        ));
        require(contracts[contractId].status == Status.INVALID, "HTLC: duplicate");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "HTLC: transferFrom failed");

        contracts[contractId] = HTLCContract({
            initiator:  msg.sender,
            recipient:  recipient,
            token:      token,
            amount:     amount,
            secretHash: secretHash,
            timelock:   timelock,
            status:     Status.LOCKED
        });

        emit Locked(contractId, msg.sender, recipient, token, amount, secretHash, timelock);
    }

    // ─── Redeem ───────────────────────────────────────────────────────────────

    /**
     * @notice Reveal the secret to claim locked funds.
     * @param contractId  HTLC identifier returned by lock*()
     * @param secret      Preimage: keccak256(secret) must equal secretHash
     */
    function redeem(bytes32 contractId, bytes32 secret) external {
        HTLCContract storage c = contracts[contractId];
        require(c.status == Status.LOCKED,                        "HTLC: not locked");
        require(block.timestamp < c.timelock,                     "HTLC: expired");
        require(keccak256(abi.encodePacked(secret)) == c.secretHash, "HTLC: bad secret");

        c.status = Status.REDEEMED;
        emit Redeemed(contractId, secret);

        _transfer(c.token, c.recipient, c.amount);
    }

    // ─── Refund ───────────────────────────────────────────────────────────────

    /**
     * @notice Recover locked funds after timelock expires.
     * @param contractId  HTLC identifier returned by lock*()
     */
    function refund(bytes32 contractId) external {
        HTLCContract storage c = contracts[contractId];
        require(c.status == Status.LOCKED,        "HTLC: not locked");
        require(block.timestamp >= c.timelock,    "HTLC: not expired");
        require(msg.sender == c.initiator,        "HTLC: not initiator");

        c.status = Status.REFUNDED;
        emit Refunded(contractId);

        _transfer(c.token, c.initiator, c.amount);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /**
     * @notice Get the full state of an HTLC contract.
     */
    function getContract(bytes32 contractId)
        external view
        returns (
            address initiator,
            address recipient,
            address token,
            uint256 amount,
            bytes32 secretHash,
            uint256 timelock,
            Status  status
        )
    {
        HTLCContract storage c = contracts[contractId];
        return (c.initiator, c.recipient, c.token, c.amount, c.secretHash, c.timelock, c.status);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "HTLC: ETH transfer failed");
        } else {
            bool ok = IERC20(token).transfer(to, amount);
            require(ok, "HTLC: token transfer failed");
        }
    }
}
