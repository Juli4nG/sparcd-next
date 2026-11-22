import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectionProbeResult, S3Config } from '@sparcd/types';
import { Connection } from '../src/Connection';

type Check = (config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>;

const offline = () => Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

function fill(login: string, password: string) {
  fireEvent.change(screen.getByLabelText('Login name'), { target: { value: login } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('Connection in gate mode', () => {
  it('asks for a login name and a password, with no endpoint or Advanced', () => {
    render(<Connection toolName="Uploader" gate onConnect={vi.fn()} />);
    expect((screen.getByLabelText('Login name') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    expect(screen.queryByLabelText('Endpoint')).toBeNull();
    expect(screen.queryByLabelText('Access key')).toBeNull();
    expect(screen.queryByLabelText('Secret key')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Advanced' })).toBeNull();
  });

  it('signs in against this page\'s own origin, with the login and password as the key pair', async () => {
    const onConnect = vi.fn();
    const check = vi.fn<Check>(() => Promise.resolve({ ok: true }));
    render(<Connection toolName="Uploader" gate onConnect={onConnect} onTestConnection={check} />);
    fill('ana', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ endpoint: window.location.origin, accessKey: 'ana', secretKey: 'pw' }), false);
  });

  it('says the login name and password did not work when the check is rejected, and does not connect', async () => {
    const onConnect = vi.fn();
    const check = vi.fn<Check>(() => Promise.resolve({ ok: false, category: 'credentials-rejected' }));
    render(<Connection toolName="Uploader" gate onConnect={onConnect} onTestConnection={check} />);
    fill('ana', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(screen.getByTestId('connection-probe-failure').textContent).toBe('That login name and password didn’t work. Check them and try again.'),
    );
    expect(onConnect).not.toHaveBeenCalled();
  });

  describe('with the browser reporting offline', () => {
    it('still runs the check when Connect is pressed, and does not connect when it fails', async () => {
      offline();
      const onConnect = vi.fn();
      const check = vi.fn<Check>(() => Promise.resolve({ ok: false, category: 'unreachable' }));
      render(<Connection toolName="Uploader" gate onConnect={onConnect} onTestConnection={check} />);
      expect(screen.getByText("No internet. You can sign in when it's back.")).not.toBeNull();
      fill('ana', 'pw');
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await waitFor(() => expect(screen.getByTestId('connection-probe-failure')).not.toBeNull());
      expect(check).toHaveBeenCalledTimes(1);
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('connects when the check passes', async () => {
      offline();
      const onConnect = vi.fn();
      const check = vi.fn<Check>(() => Promise.resolve({ ok: true }));
      render(<Connection toolName="Uploader" gate onConnect={onConnect} onTestConnection={check} />);
      fill('ana', 'pw');
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
      expect(check).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Connection outside gate mode, offline', () => {
  it('connects without running the check', () => {
    offline();
    const onConnect = vi.fn();
    const check = vi.fn<Check>(() => Promise.resolve({ ok: false, category: 'unreachable' }));
    render(<Connection toolName="Uploader" onConnect={onConnect} onTestConnection={check} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'wildcats.sparcd.arizona.edu' } });
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'ak' } });
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(check).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
