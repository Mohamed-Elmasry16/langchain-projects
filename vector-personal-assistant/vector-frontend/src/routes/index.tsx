import { createFileRoute } from "@tanstack/react-router";
import { VectorOS } from "@/components/vector/VectorOS";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "VECTOR // AI Operating System" },
      { name: "description", content: "Command the AI. Search, analyze, retrieve, generate, solve — inside a cinematic operating system." },
      { property: "og:title", content: "VECTOR // AI Operating System" },
      { property: "og:description", content: "Command the AI. Search, analyze, retrieve, generate, solve — inside a cinematic operating system." },
    ],
  }),
});

function Index() {
  return <VectorOS />;
}
