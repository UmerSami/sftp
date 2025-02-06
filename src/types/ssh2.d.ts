declare module 'ssh2' {
    import { EventEmitter } from 'events';

    export interface ServerConfig {
        hostKeys: Buffer[];
    }

    export class Server extends EventEmitter {
        constructor(config: ServerConfig); // ✅ Now correctly requires config
        listen(port: number, host?: string, callback?: () => void): this;
    }

    export class Connection extends EventEmitter {
        on(event: 'authentication', listener: (ctx: AuthContext) => void): this;
        on(event: 'ready', listener: () => void): this;
        on(event: 'session', listener: (accept: () => Session) => void): this;
        on(event: 'end', listener: () => void): this;
    }

    export interface AuthContext {
        method: string;
        username: string;
        password: string;
        accept(): void;
        reject(methods?: string[]): void;
    }

    export class Session extends EventEmitter {
        on(event: 'sftp', listener: (accept: () => SFTPStream) => void): this;
    }
    export class SFTPStream extends EventEmitter { 
        on(event: 'OPEN', listener: (reqid: number, filename: string, flags: number, attrs: any) => void): this;
        on(event: 'CLOSE', listener: (reqid: number, handle: Buffer) => void): this;
        on(event: 'REALPATH', listener: (reqid: number, path: string) => void): this;
        on(event: 'OPENDIR', listener: (reqid: number, path: string) => void): this;
        on(event: 'READDIR', listener: (reqid: number, handle: Buffer) => void): this;
        
        // ✅ Correctly typed READ event
        on(event: 'READ', listener: (reqid: number, handle: Buffer, offset: number, length: number) => void): this;
        
        // ✅ Correctly typed WRITE event
        on(event: 'WRITE', listener: (reqid: number, handle: Buffer, offset: number, data: Buffer) => void): this;
        
        name(reqid: number, attrs: any): void;
        handle(reqid: number, handle: Buffer): void;
        status(reqid: number, code: number): void;
        
        // ✅ Correct method for sending file data
        data(reqid: number, data: Buffer): void;
    }
    
    
}
