import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthGateway } from "@/features/auth/auth-gateway";

export default async function AuthPage() {
  const { userId } = await auth();
  if (userId) redirect("/workspace");
  return <AuthGateway />;
}
