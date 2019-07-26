import { ElkClient, ElkClientOptions } from 'elk-client';
import { fibonacci, Backoff } from 'backoff';
import { ElkMessage } from 'elk-message';
import { EventEmitter } from 'events';

export default class ElkReconnector extends EventEmitter {
    private readonly client: ElkClient;
    private readonly backoff: Backoff;
    private active: boolean = false;
    private stopped: boolean = true;

    constructor(options?: ElkClientOptions) {
        super();

        this.client = new ElkClient(options);
        this.client.on('ready', this.onClientReady);
        this.client.on('error', this.onClientError);
        this.client.on('message', this.onClientMessage)
        this.client.on('ok', this.onClientOk);
        this.client.on('disconnected', this.onClientDisconnected);

        this.backoff = fibonacci({
            randomisationFactor: 0,
            initialDelay: 1000,
            maxDelay: 30000
        });
        this.backoff.on('ready', this.onBackoffReady);
        this.backoff.on('fail', this.onBackoffFail);
        this.backoff.on('backoff', this.onBackoffStart);
    }

    async start() {
        if (this.active) {
            return Promise.resolve(this.client.isConnected);
        }

        this.active = true;
        this.stopped = false;
        this.emit('starting');
        return this.client.connect()
            .then(() => true)
            .catch((err) => {
                console.log('WTFFFFFFFFFFFFFFFFFF', err);
            })
            .then((isConnected) => {
                this.emit('started', isConnected);
                return isConnected;
            });
    }

    async stop() {
        if (!this.active) {
            return new Promise((resolve) => {
                if (this.stopped) {
                    return resolve();
                } else {
                    this.once('stopped', resolve);
                }
            });
        }

        return this.stopInternal();
    }

    async stopInternal(error?: Error) {
        this.active = false;
        this.emit('stopping', error);
        await this.client.disconnect();
        this.stopped = false;
        this.emit('stopped', error);
    }

    private onClientReady = () => {
        this.backoff.reset();
        this.emit('ready');
    }

    private onClientError = (error: Error) => {
        this.emit('clientError', error);
    }

    private onClientMessage = (message: ElkMessage) => {
        this.emit('message', message);
    }

    private onClientOk = () => {
        this.emit('ok');
    }

    private onClientDisconnected = (error?: Error) => {
        this.emit('disconnected', error);
        if (this.active) {
            this.backoff.backoff();
        }
    }

    private onBackoffStart = (number: number, delay: number) => {
        this.emit('wait', number, delay);
    }

    private onBackoffReady = (number: number, delay: number) => {
        this.emit('retry', number, delay);
        this.client.connect().catch(() => undefined);
    }

    private onBackoffFail = () => {
        const error = new Error('Could not connect after retrying');
        this.emit('error', error);
        this.stopInternal(error);
    }
}