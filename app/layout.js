import "./globals.css";

export const metadata = {
  title: "Projekt_space",
  description: "A persistent multiplayer sci-fi strategy game.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
