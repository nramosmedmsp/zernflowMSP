import { redirect } from "next/navigation";

// Sin página pública: la raíz lleva al panel. Si no hay sesión, el middleware
// redirige /dashboard a /login.
export default function Home() {
  redirect("/dashboard");
}
