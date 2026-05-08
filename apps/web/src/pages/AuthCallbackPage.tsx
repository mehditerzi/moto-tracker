import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "@/hooks/useMe";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const me = useMe();
  useEffect(() => {
    if (me.isSuccess) navigate("/bikes", { replace: true });
    if (me.isError) navigate("/sign-in", { replace: true });
  }, [me.isSuccess, me.isError, navigate]);
  return <p className="text-center text-muted dark:text-muted-dark">Yönlendiriliyor...</p>;
}
