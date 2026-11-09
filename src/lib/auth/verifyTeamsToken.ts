import 'server-only';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { APP_ID_URI } from '@/config/app';
import { serverEnv } from '@/config/env';

import type { JWTPayload } from 'jose';

/** Данные сотрудника из токена Entra ID, выданного клиентом Teams. */
export interface TeamsIdentity {
  /** Object ID в Entra ID — ключ, по которому сотрудник ищется в employees. */
  entraOid: string;
  tenantId: string;
  upn: string;
  displayName: string;
}

interface EntraClaims extends JWTPayload {
  oid?: string;
  tid?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

// Ленивая инициализация: переменные окружения не должны требоваться на этапе сборки.
function getJwks() {
  jwks ??= createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${serverEnv.entraTenantId}/discovery/v2.0/keys`),
  );
  return jwks;
}

/**
 * Проверяет токен, полученный во вкладке через teams-js getAuthToken().
 * Клиент Teams может прислать aud как Application ID URI, так и client id,
 * поэтому принимаются оба значения.
 */
export async function verifyTeamsToken(token: string): Promise<TeamsIdentity> {
  const { payload } = await jwtVerify<EntraClaims>(token, getJwks(), {
    issuer: `https://login.microsoftonline.com/${serverEnv.entraTenantId}/v2.0`,
    audience: [APP_ID_URI, serverEnv.entraClientId],
  });

  if (payload.tid !== serverEnv.entraTenantId) {
    throw new Error('Токен выдан в другом тенанте');
  }
  if (!payload.oid) {
    throw new Error('В токене нет oid');
  }

  return {
    entraOid: payload.oid,
    tenantId: payload.tid,
    upn: payload.preferred_username ?? payload.upn ?? '',
    displayName: payload.name ?? '',
  };
}
