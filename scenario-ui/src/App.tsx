import { useEffect, useState } from "react";
import PasswordGate from "@/components/app/PasswordGate";
import ControlPanel from "@/components/app/ControlPanel";
import { getAuth, logout } from "@/lib/api";

type AuthState = "checking" | "signed-in" | "needs-password";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [passwordRequired, setPasswordRequired] = useState(false);

  useEffect(() => {
    getAuth()
      .then(({ passwordRequired, authed }) => {
        setPasswordRequired(passwordRequired);
        setAuth(passwordRequired && !authed ? "needs-password" : "signed-in");
      })
      .catch(() => setAuth("needs-password"));
  }, []);

  if (auth === "checking") return null;

  if (auth === "needs-password") {
    return <PasswordGate onSignedIn={() => setAuth("signed-in")} />;
  }

  return (
    <ControlPanel
      onSignOut={
        passwordRequired
          ? async () => {
              await logout();
              setAuth("needs-password");
            }
          : undefined
      }
    />
  );
}
