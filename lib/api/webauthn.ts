/** Convert ArrayBuffer <-> base64url for WebAuthn wire format. */

export function bufferToBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function revivePublicKeyCreate(options: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((item) => ({
      ...item,
      id: base64UrlToBuffer(item.id),
      type: item.type ?? 'public-key',
    })),
  } as PublicKeyCredentialCreationOptions;
}

function revivePublicKeyRequest(options: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((item) => ({
      ...item,
      id: base64UrlToBuffer(item.id),
      type: item.type ?? 'public-key',
    })),
  } as PublicKeyCredentialRequestOptions;
}

export type PublicKeyCredentialCreationOptionsJSON = {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Array<{ id: string; type?: PublicKeyCredentialType; transports?: AuthenticatorTransport[] }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
};

export type PublicKeyCredentialRequestOptionsJSON = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{ id: string; type?: PublicKeyCredentialType; transports?: AuthenticatorTransport[] }>;
  userVerification?: UserVerificationRequirement;
};

export function passkeySupported() {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials?.create === 'function';
}

export async function createPasskey(publicKey: PublicKeyCredentialCreationOptionsJSON) {
  const credential = await navigator.credentials.create({
    publicKey: revivePublicKeyCreate(publicKey),
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('パスキーの作成がキャンセルされました');
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
  };
}

export async function getPasskey(publicKey: PublicKeyCredentialRequestOptionsJSON) {
  const credential = await navigator.credentials.get({
    publicKey: revivePublicKeyRequest(publicKey),
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('パスキー認証がキャンセルされました');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
  };
}
