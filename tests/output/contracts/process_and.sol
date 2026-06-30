//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "hardhat/console.sol";

interface IProcessExecution {
  function enact(uint id) external;
  function getTokenState() external view returns (uint);
}

contract process_and is IProcessExecution {
  uint private tokenState = 1;
  address[1] public participants;
  event Task(uint id);

  constructor(address[1] memory _participants) {
    participants = _participants;
  }

  function getTokenState() external view returns (uint) {
    return tokenState;
  }

  function enact(uint id) external {
    uint _tokenState = tokenState;

    console.log(
      "process_and: current token state is %d, sender %s trying to execute task %d",
      _tokenState,
      msg.sender,
      id
    );
    while(_tokenState != 0) {
      if (_tokenState & 1 == 1) {
        // <--- task_a Task A --->
        if (1 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(1);
          _tokenState |= 6;
          emit Task(1);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 2 == 2) {
        // <--- task_b Task B --->
        if (2 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(2);
          _tokenState |= 8;
          emit Task(2);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 4 == 4) {
        // <--- task_c Task C --->
        if (3 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(4);
          _tokenState |= 16;
          emit Task(3);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 24 == 24) {
        // <---  auto transition  --->
        _tokenState &= ~uint(24);
        _tokenState |= 0;
        break; // is end
      }
      break;
    }

    tokenState = _tokenState;
    console.log(
      "process_and: new token state is %d",
       _tokenState
    );
  }

}
