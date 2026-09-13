import { useEffect, useState } from "react";
import PasswordGate from "@/components/app/PasswordGate";
import ScenarioBoard from "@/components/app/ScenarioBoard";
import { getAuth, logout } from "@/lib/api";

type AuthState = "checking" | "signed-in" | "needs-password";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [passwordRequired, setPasswordRequired] = useState(false);

  useEffect(() => {
    getAuth()
      .then(({ passwordRequired }) => {
        setPasswordRequired(passwordRequired);
        setAuth(passwordRequired ? "needs-password" : "signed-in");
      })
      .catch(() => setAuth("needs-password"));
  }, []);

  if (auth === "checking") return null;

  if (auth === "needs-password") {
    return <PasswordGate onSignedIn={() => setAuth("signed-in")} />;
  }

  return (
    <ScenarioBoard
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
