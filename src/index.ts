import pino from "pino";
import ElkReconnector from './ElkReconnector';
import { ElkMessage } from 'elk-message';
import MessageRecorder from "./MessageRecorder";

let client: ElkReconnector;
let messageRecorder: MessageRecorder;

const logger = pino({
    name: process.env.LOG_NAME || 'elk-logger',
    enabled: process.env.LOG_DISABLED !== '1',
    prettyPrint: process.env.LOG_RAW !== '1',
    level: process.env.LOG_LEVEL || 'info',
});
const fatalLogger = process.env.LOG_RAW !== '1' ? pino() : logger;

const logHeartbeats = process.env.INCLUDE_HEARBEAT === '1';

const start = async () => {
    const clientLogger = logger.child({ module: 'client' })
    client = new ElkReconnector({
        username: process.env.ELK_USERNAME,
        password: process.env.ELK_PASSWORD,
        connection: {
            secure: process.env.ELK_SECURE === '1',
            host: process.env.ELK_HOST,
            port: process.env.ELK_PORT ? parseInt(process.env.ELK_PORT, 10) : undefined,
        },
    });

    client.on('started', () => logger.info('started'));
    client.on('stopping', (error) => logger[error ? 'error': 'info']('stopping', error));
    client.on('stopped', (error) => logger[error ? 'error' : 'log']('stopped', error));
    client.on('ready', () => clientLogger.info('ready'));
    client.on('clientError', (error) => clientLogger.warn('error', error));
    client.on('message', (message: ElkMessage) => {
        if(message.messageType === 'X' && message.subMessageType === 'K') {
            clientLogger.trace(message.raw);
        } else {
            clientLogger.debug(message.raw);
        }
    });
    client.on('ok', () => clientLogger.debug('ok'));
    client.on('disconnected', () => clientLogger.info('disconnected'));
    client.on('wait', (number, delay) => logger.info('waiting ', { delay, number }));
    client.on('retry', (number, delay) => logger.info('retrying', { delay, number }));
    client.on('error', (error) => logger.error(error));

    const recorderLogger = logger.child({ module: 'recorder' })
    messageRecorder = new MessageRecorder(client, {
        dbUrl: process.env.DB_URL,
        logHeartbeats,
    });
    messageRecorder.on('init', (tableName, dbConfig) => {
        recorderLogger.debug('init', { tableName, dbConfig });
    });
    messageRecorder.on('flush', (records) => {
        recorderLogger.info(`wrote ${records}`, { records });
    });
    messageRecorder.on('closing', () => {
        recorderLogger.debug('closing');
    });
    messageRecorder.on('closed', () => {
        recorderLogger.debug('closed');
    });


    return messageRecorder.init().then(() => client.start());
}

const stop = async () => {
    if (client) {
        await client.stop();
        client.removeAllListeners();
    }

    if (messageRecorder) {
        await messageRecorder.close();
        messageRecorder.removeAllListeners();
    }
}

start().then(() => {
    logger.info('OK...');
}).catch((error) => {
    logger.error(error);
    stop();
    process.exit(1);
})

process.on('SIGTERM', async function onSigterm () {
    logger.info('SIGTERM');
    await stop();
    process.exit()
});

process.on('SIGQUIT', async function onSigquit () {
    logger.info('SIGQUIT');
    await stop();
    process.exit()
});

process.on('unhandledRejection', pino.final(fatalLogger, (err, finalLogger) => {
    finalLogger.error(err, 'unhandledRejection');
}));

process.on('uncaughtException',  pino.final(fatalLogger, (err, finalLogger) => {
    finalLogger.error(err, 'uncaughtException');
    process.exit(1)
}));
