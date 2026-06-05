import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BioCard({ bio }: { bio: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[14px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {bio}
        </p>
      </CardContent>
    </Card>
  );
}
