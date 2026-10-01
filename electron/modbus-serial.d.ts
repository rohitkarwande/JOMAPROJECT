declare module 'modbus-serial' {
  export interface RTUOptions {
    baudRate?: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
  }

  export interface TCPOptions {
    port?: number;
  }

  export default class ModbusRTU {
    constructor();
    connectRTUBuffered(path: string, options: RTUOptions, next?: (err?: Error) => void): Promise<void>;
    connectRTU(path: string, options: RTUOptions, next?: (err?: Error) => void): Promise<void>;
    connectTCP(ip: string, options?: TCPOptions, next?: (err?: Error) => void): Promise<void>;
    close(callback?: (err?: Error) => void): void;
    isOpen: boolean;
    setID(id: number): void;
    setTimeout(ms: number): void;
    readHoldingRegisters(address: number, length: number): Promise<{ data: number[]; buffer: Buffer }>;
    readInputRegisters(address: number, length: number): Promise<{ data: number[]; buffer: Buffer }>;
    readCoils(address: number, length: number): Promise<{ data: boolean[]; buffer: Buffer }>;
    writeCoil(address: number, state: boolean): Promise<{ address: number; state: boolean }>;
    writeRegister(address: number, value: number): Promise<{ address: number; value: number }>;
    writeRegisters(address: number, values: number[]): Promise<{ address: number; length: number }>;
  }
}
