//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "hardhat/console.sol";

interface IProcessExecution {
  function enact(uint id) external;
  function getTokenState() external view returns (uint);
}

contract collab_2 is IProcessExecution {
  uint private tokenState = 1;
  address[2] public participants;
  event Task(uint id);

  constructor(address[2] memory _participants) {
    participants = _participants;
  }

  function getTokenState() external view returns (uint) {
    return tokenState;
  }

  function enact(uint id) external {
    uint _tokenState = tokenState;

    console.log(
      "collab_2: current token state is %d, sender %s trying to execute task %d",
      _tokenState,
      msg.sender,
      id
    );
    while(_tokenState != 0) {
      if (_tokenState & 1 == 1) {
        // <---  auto transition  --->
        _tokenState &= ~uint(1);
        _tokenState |= 6;
        continue;
      }
      if (_tokenState & 24 == 24) {
        // <---  auto transition  --->
        _tokenState &= ~uint(24);
        _tokenState |= 0;
        break; // is end
      }
      if (_tokenState & 2 == 2) {
        // <--- task_browse Browse Menu --->
        if (1 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(2);
          _tokenState |= 32;
          emit Task(1);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 36 == 36) {
        // <--- task_order Order Pizza --->
        if (2 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(36);
          _tokenState |= 192;
          emit Task(2);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 128 == 128) {
        // <--- task_prepare Prepare Pizza --->
        if (3 == id && msg.sender == participants[1]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(128);
          _tokenState |= 256;
          emit Task(3);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 320 == 320) {
        // <--- task_deliver Deliver Pizza --->
        if (4 == id && msg.sender == participants[1]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(320);
          _tokenState |= 24;
          emit Task(4);
          id = 0;
          continue;
        }
      }
      break;
    }

    tokenState = _tokenState;
    console.log(
      "collab_2: new token state is %d",
       _tokenState
    );
  }

}
