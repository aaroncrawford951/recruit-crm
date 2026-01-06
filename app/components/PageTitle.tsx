export default function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontSize: 28,
        fontWeight: 800,
        marginBottom: 16,
        color: "#0f172a", // matches your app text
      }}
    >
      {children}
    </h1>
  );
}
