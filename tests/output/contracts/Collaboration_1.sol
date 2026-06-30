//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "hardhat/console.sol";

interface IProcessExecution {
  function enact(uint id) external;
  function getTokenState() external view returns (uint);
}

contract Collaboration_1 is IProcessExecution {
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
      "Collaboration_1: current token state is %d, sender %s trying to execute task %d",
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
      if (_tokenState & 6 == 6) {
        // <--- task_send_order Order --->
        if (1 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(6);
          _tokenState |= 96;
          emit Task(1);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 96 == 96) {
        // <--- task_send_confirmation Confirmation --->
        if (2 == id && msg.sender == participants[1]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(96);
          _tokenState |= 24;
          emit Task(2);
          id = 0;
          continue;
        }
      }
      break;
    }

    tokenState = _tokenState;
    console.log(
      "Collaboration_1: new token state is %d",
       _tokenState
    );
  }

}
