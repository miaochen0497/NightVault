// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

contract ERC7984Test is ERC7984, SepoliaConfig {
    constructor() ERC7984("fTest", "fTEST", "") {}

    function mintFree() public {
        _mint(msg.sender, FHE.asEuint64(100*1000000));
    }
}
