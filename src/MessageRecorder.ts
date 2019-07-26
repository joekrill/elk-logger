import { ElkMessage } from "elk-message";
import knex from 'knex';
import path from "path";
import url from "url";
import { EventEmitter } from "events";

const DEFAULT_TABLE_NAME = 'elk_messages';

export default class MessageWriter extends EventEmitter {
    private dbConfig: knex.Config = {
        client: 'sqlite3',
        connection: {
            filename: "./mydb.sqlite"
        },
        useNullAsDefault: true,
    };
    private db: knex;
    private tableName: string = DEFAULT_TABLE_NAME;
    private flushTimeout: NodeJS.Timeout;
    private flushInterval: number = 30 * 1000;
    private messages: {
        received: number,
        message: string,
        command?: string
    }[] = [];
    private logHeartbeats: boolean = false;
    private finished = false;

    constructor(readonly client: {
        on(event: 'message', listener: (message: ElkMessage) => any): any;
        removeListener(event: 'message', listener: (message: ElkMessage) => any): any;
        on(event: 'ok', listener: () => any): any;
        removeListener(event: 'ok', listener: () => any): any;
    }, {
        dbUrl,
        logHeartbeats
    }: {
        dbUrl?: string,
        logHeartbeats?: boolean,
    } = {}) {
        super();

        this.logHeartbeats = !!logHeartbeats;

        client.on('message', this.onClientMessage);
        client.on('ok', this.onClientOk);

        this.flushTimeout = setTimeout(this.flush, this.flushInterval);

        if (dbUrl) {
            const { host, path: urlPath, protocol, query } = url.parse(dbUrl, true);
            switch (protocol) {
                case 'postgesql:': {
                    this.dbConfig = {
                        client: 'pg',
                        connection: dbUrl,
                    };
                }
                case 'sqlite:':
                case 'sqlite3:':
                case 'file:': {
                    if (host || urlPath) {
                        const filename = path.join(host || '', urlPath || '');
                        this.dbConfig.connection = { filename };
                    }
                }
            }
            if (query && query.table) {
                this.tableName = query.table.toString();
            }
        }
        this.db = knex(this.dbConfig);

    }

    async init() {
        this.emit('init', this.tableName, this.dbConfig);
        return this.db.schema.hasTable(this.tableName)
            .then((hasTable) => {
                if (!hasTable) {
                    this.emit('schema', this.tableName);
                    return this.db.schema.createTable(this.tableName, (table) => {
                        table.bigIncrements();
                        table.timestamp('received');
                        table.string('message');
                        table.string('command');
                    });
                }

                return false;
            });
    }

    async close() {
        this.emit('closing');
        this.client.removeListener('message', this.onClientMessage);
        this.client.removeListener('ok', this.onClientOk);
        await this.flush(true);
        this.finished = true;
        this.emit('closed');
    }

    private flush = async (final: boolean = false) => {
        clearTimeout(this.flushTimeout);
        if (this.messages.length) {
            const num = this.messages.length;
            await this.db(this.tableName).insert(this.messages.splice(0, this.messages.length));
            this.emit('flush', num);
        }

        if (!final) {
            this.flushTimeout = setTimeout(this.flush, this.flushInterval);
        }
    }

    onClientMessage = (message: ElkMessage) => {
        if (!this.logHeartbeats && message.messageType === 'X' && message.subMessageType === 'K') {
            return;
        }
        this.emit('message', message);
        this.messages.push({
            received: Date.now(),
            message: message.raw,
            command: (message.messageType || '') + (message.subMessageType || ''),
        });
    }

    onClientOk = () => {
        this.emit('ok');
        this.messages.push({
            received: Date.now(),
            message: 'OK',
        });
    }
}