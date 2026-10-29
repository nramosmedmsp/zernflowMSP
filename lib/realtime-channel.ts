// Nombre único de canal de Realtime por montaje. Supabase reutiliza el canal
// que ya existe con el mismo nombre: si se cambia de chat y se vuelve rápido,
// el efecto nuevo recibía el canal viejo (a medio cerrar) y se quedaba sin
// suscripción. Con un sufijo distinto en cada montaje nunca se comparte.

let counter = 0;

export function uniqueChannelName(base: string): string {
  counter += 1;
  return `${base}#${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
