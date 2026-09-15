import React from "react";
import { Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { safeLog, sanitizeErrorForLog } from "@/lib/safeLog";

type Props = {
  product: "movies" | "series";
  providerId: string;
  onBack: () => void;
  children: React.ReactNode;
};

type State = { error: Error | null; retryKey: number };

export class StalkerProductErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    safeLog.error("LS_STALKER_PRODUCT_RENDER_ERROR", {
      product: this.props.product,
      providerId: this.props.providerId,
      error: sanitizeErrorForLog(error),
    });
  }

  componentDidUpdate(previous: Props) {
    if (previous.providerId !== this.props.providerId || previous.product !== this.props.product) {
      this.setState({ error: null, retryKey: 0 });
    }
  }

  private retry = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return <StalkerProductFailureCard product={this.props.product} onRetry={this.retry} onBack={this.props.onBack} />;
    }
    return <React.Fragment key={`${this.props.providerId}:${this.props.product}:${this.state.retryKey}`}>
      {this.props.children}
    </React.Fragment>;
  }
}

function StalkerProductFailureCard({ product, onRetry, onBack }: { product: "movies" | "series"; onRetry: () => void; onBack: () => void }) {
  const colors = useColors();
  return <View style={{ flex: 1, padding: 18, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: "100%", maxWidth: 720, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }}>
      <Text style={{ color: colors.destructive, fontSize: 20, fontWeight: "900" }}>
        {product === "series" ? "Diziler açılamadı" : "Filmler açılamadı"}
      </Text>
      <Text style={{ color: colors.mutedForeground }}>
        Bu içerik ekranında beklenmeyen bir hata oluştu. Uygulamayı yeniden başlatmadan tekrar deneyebilir veya ana ekrana dönebilirsiniz.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <FocusButton label="Tekrar dene" icon="refresh-cw" variant="primary" onPress={onRetry} />
        <FocusButton label="Ana ekrana dön" icon="home" variant="secondary" onPress={onBack} />
      </View>
    </View>
  </View>;
}
