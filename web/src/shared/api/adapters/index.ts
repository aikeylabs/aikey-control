/**
 * View model adapters – map raw DTOs to UI-friendly shapes.
 */
import type { VirtualKeyDTO } from '../types/managed-keys';
import type { SeatDTO } from '../types/orgs';
import type { ProviderDTO, CredentialDTO } from '../types/providers';
import type {
  SeatListItemVM,
  VirtualKeyListItemVM,
  ProviderListItemVM,
  CredentialListItemVM,
} from '@/shared/types';

export function toSeatListItem(dto: SeatDTO): SeatListItemVM {
  return {
    id: dto.seat_id,
    email: dto.invited_email,
    role: 'member',
    status: dto.seat_status as SeatListItemVM['status'],
    createdAt: dto.created_at,
  };
}

export function toVirtualKeyListItem(dto: VirtualKeyDTO): VirtualKeyListItemVM {
  return {
    id: dto.virtual_key_id,
    alias: dto.alias,
    prefix: dto.current_revision,
    status: dto.key_status as VirtualKeyListItemVM['status'],
    createdAt: dto.updated_at,
    expiresAt: dto.expires_at,
  };
}

export function toProviderListItem(dto: ProviderDTO): ProviderListItemVM {
  return {
    id: dto.provider_id,
    name: dto.display_name,
    type: dto.protocol_type,
    baseUrl: dto.default_base_url,
    status: dto.status as ProviderListItemVM['status'],
    createdAt: '',
  };
}

export function toCredentialListItem(dto: CredentialDTO): CredentialListItemVM {
  return {
    id: dto.credential_id,
    alias: dto.display_name,
    providerId: dto.provider_id,
    status: dto.status as CredentialListItemVM['status'],
    createdAt: dto.created_at,
    lastRotatedAt: dto.updated_at,
  };
}
