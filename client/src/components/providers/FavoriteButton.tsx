import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { isFavorite: boolean; onClick: (e: React.MouseEvent) => void };

export function FavoriteButton({ isFavorite, onClick }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
    >
      <Star className={cn("h-4 w-4", isFavorite && "fill-primary text-primary")} />
    </Button>
  );
}
