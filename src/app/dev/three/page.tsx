// Dev page: the 3D replay with a synthetic push-up rep or the cached pull-up rep.
//   /dev/three?ex=push_up | /dev/three?ex=pull_up   (…&single=1: one frame, no rep)
import { notFound } from "next/navigation";
import { DevThreeStage } from "@/components/three/DevThreeStage";

export default async function DevThreePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const ex = sp.ex === "pull_up" ? "pull_up" : "push_up";
  return <DevThreeStage ex={ex} single={sp.single === "1"} />;
}
