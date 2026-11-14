import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ResolvedAddress } from './url-guard.js';

export const WEBHOOK_TIMEOUT_MS = 10_000;
/** How much of a response body is kept for the delivery log. */
export const WEBHOOK_RESPONSE_LIMIT = 2048;

export interface WebhookRequest {
  url: URL;
  /** The checked address to connect to. The hostname is still used for TLS and the Host header. */
  address: ResolvedAddress;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookResponse {
  status: number;
  body: string;
}

/** Sends one webhook request. Rejects on a network error or timeout. */
export type WebhookTransport = (request: WebhookRequest) => Promise<WebhookResponse>;

/**
 * POSTs with node's http client, pinned to the address the guard checked: the `lookup` hook
 * answers with that address, so the host is not resolved a second time. Redirects are not
 * followed and at most WEBHOOK_RESPONSE_LIMIT bytes of the answer are read.
 */
export const pinnedTransport: WebhookTransport = (request) =>
  new Promise((resolve, reject) => {
    const { url, address } = request;
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: address.address, family: address.family }]);
      } else {
        callback(null, address.address, address.family);
      }
    };
    const client = url.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => {
      req.destroy(new Error(`Timed out after ${request.timeoutMs / 1000} s`));
    }, request.timeoutMs);
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...request.headers, 'content-length': Buffer.byteLength(request.body) },
        lookup: pinned,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).subarray(0, WEBHOOK_RESPONSE_LIMIT).toString('utf8'),
          });
        };
        res.on('data', (chunk: Buffer) => {
          if (size >= WEBHOOK_RESPONSE_LIMIT) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= WEBHOOK_RESPONSE_LIMIT) {
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(request.body);
  });
