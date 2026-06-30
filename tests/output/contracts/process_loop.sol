//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "hardhat/console.sol";

interface IProcessExecution {
  function enact(uint id) external;
  function getTokenState() external view returns (uint);
}

contract process_loop is IProcessExecution {
  uint private tokenState = 1;
  address[1] public participants;
  event Task(uint id);

  // Case Variable repeat
  bool public repeat = false;
  function setRepeat(bool _repeat) external {
    repeat = _repeat;
  }

  constructor(address[1] memory _participants) {
    participants = _participants;
  }

  function getTokenState() external view returns (uint) {
    return tokenState;
  }

  function enact(uint id) external {
    uint _tokenState = tokenState;

    console.log(
      "process_loop: current token state is %d, sender %s trying to execute task %d",
      _tokenState,
      msg.sender,
      id
    );
    while(_tokenState != 0) {
      if (_tokenState & 1 == 1) {
        if (repeat==true) {
          // <--- task_a Task A --->
          if (1 == id && msg.sender == participants[0]) {
            // <--- custom code for task here --->
            _tokenState &= ~uint(1);
            _tokenState |= 1;
            emit Task(1);
            id = 0;
            continue;
          }
        }
        else {
          // <---  auto transition  --->
          _tokenState &= ~uint(1);
          _tokenState |= 0;
          break; // is end
        }
      }
      break;
    }

    tokenState = _tokenState;
    console.log(
      "process_loop: new token state is %d",
       _tokenState
    );
  }

}
