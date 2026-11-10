import type { RawService } from "./service";

/** Cuenta de Auth de una persona del espacio (nombre, correo, último ingreso). Null si ya no existe. */
export async function authIdentityOf(service: RawService, userId: string) {
  const {
    data: { user },
  } = await service.auth.admin.getUserById(userId);
  return user ?? null;
}
