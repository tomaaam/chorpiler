//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IProcessExecution {
  function enact(uint id) external;
  function getTokenState() external view returns (uint);
}

contract process_lanes_single is IProcessExecution {
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

    while(_tokenState != 0) {
      if (_tokenState & 1 == 1) {
        // <--- task_request Request --->
        if (1 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(1);
          _tokenState |= 2;
          emit Task(1);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 2 == 2) {
        // <--- task_approve Approve --->
        if (2 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(2);
          _tokenState |= 4;
          emit Task(2);
          id = 0;
          continue;
        }
      }
      if (_tokenState & 4 == 4) {
        // <--- task_pay Pay --->
        if (3 == id && msg.sender == participants[0]) {
          // <--- custom code for task here --->
          _tokenState &= ~uint(4);
          _tokenState |= 0;
          emit Task(3);
          break; // is end
        }
      }
      break;
    }

    tokenState = _tokenState;
  }

}
