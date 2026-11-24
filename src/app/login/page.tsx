import { getAuthMode } from "@/lib/auth-mode";
import EmailLoginPage from "./EmailLoginPage";
import ApiKeyLoginPage from "./ApiKeyLoginPage";

// Runtime evaluation is important: do not bake AUTH_MODE into a static page.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return getAuthMode() === "api_key" ? <ApiKeyLoginPage /> : <EmailLoginPage />;
}
