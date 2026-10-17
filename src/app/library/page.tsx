import type { Metadata } from "next";
import { WorkoutLibrary } from "@/components/library/WorkoutLibrary";

export const metadata: Metadata = { title: "Workout library | Gym Bro" };

export default function LibraryPage() {
  return <WorkoutLibrary />;
}
