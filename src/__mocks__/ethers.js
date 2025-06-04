import { jest } from '@jest/globals';

// Mock ethers for testing
jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue('1000000000000000000'), // 1 ETH
      getBlockNumber: jest.fn().mockResolvedValue(12345),
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: '1000000000', // 1 gwei
        maxFeePerGas: '2000000000',
        maxPriorityFeePerGas: '1000000000'
      })
    })),
    WebSocketProvider: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      destroy: jest.fn(),
      _start: jest.fn()
    })),
    Wallet: jest.fn().mockImplementation(() => ({
      address: '0x1234567890123456789012345678901234567890',
      signTransaction: jest.fn(),
      provider: {}
    })),
    Contract: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      removeAllListeners: jest.fn()
    })),
    Interface: jest.fn().mockImplementation(() => ({
      encodeFunctionData: jest.fn().mockReturnValue('0x1234')
    })),
    isAddress: jest.fn().mockReturnValue(true),
    formatEther: jest.fn().mockReturnValue('1.0'),
    parseEther: jest.fn().mockReturnValue('1000000000000000000'),
    parseUnits: jest.fn().mockReturnValue('1000000000')
  }
}));

export default {};
