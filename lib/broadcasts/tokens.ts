// Variables que se pueden usar en las plantillas de difusiones y secuencias
// (sin dependencias de servidor, para la interfaz).

export interface ContactVariable {
  token: string;
  label: string;
}

export const CONTACT_VARIABLES: readonly ContactVariable[] = [
  { token: "{nombre}", label: "Nombre del contacto" },
  { token: "{fecha_clave}", label: "Fecha clave" },
  { token: "{empresa}", label: "Empresa" },
];

/** Variable de un campo personalizado: `{campo:slug}`. */
export function customFieldToken(slug: string): string {
  return `{campo:${slug}}`;
}

export const SEGMENT_NONE_VALUE = "none";
