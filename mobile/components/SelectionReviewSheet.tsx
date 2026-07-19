import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { LivePlayer, Position } from "../types/match";
import { COLORS } from "../theme/colors";

interface SelectionReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  selected: Partial<Record<Position, LivePlayer>>;
  matchTitle: string;
  startsAt: string;
  countdown: string;
  onConfirm: () => void;
  isSubmitting?: boolean;
}

export const SelectionReviewSheet: React.FC<SelectionReviewSheetProps> = ({
  visible,
  onClose,
  selected,
  matchTitle,
  countdown,
  onConfirm,
  isSubmitting = false
}) => {
  const renderReviewItem = (pos: Position, label: string) => {
    const player = selected[pos];
    if (!player) return null;

    return (
      <View style={styles.pickItem} key={pos}>
        <Text style={styles.pickRole}>{label}</Text>
        <Text style={styles.pickName}>{player.name}</Text>
        <Text style={styles.pickMeta}>
          {player.starter ? "Starter" : "Official Substitute"} · #{player.number ?? "—"}
        </Text>
        {!player.starter && (
          <Text style={styles.warningText}>
            ⚠️ May receive no rating if he does not enter the match.
          </Text>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Review and Lock Selection</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.matchCopy}>
              {matchTitle} · Selections lock in {countdown}
            </Text>

            <View style={styles.picksList}>
              {renderReviewItem("ATT", "ATTACKER")}
              {renderReviewItem("MID", "MIDFIELDER")}
              {renderReviewItem("DEF", "DEFENDER")}
            </View>

            <Text style={styles.noticeText}>
              Picks will be locked securely on the server. You cannot change your choices once the match has kicked off.
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.confirmBtn, isSubmitting && styles.disabledBtn]}
                onPress={onConfirm}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmBtnText}>
                  {isSubmitting ? "Locking..." : "Confirm and lock"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>Keep editing</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end"
  },
  sheet: {
    backgroundColor: COLORS.paper || "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
    padding: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line || "#e2e8f0",
    paddingBottom: 12,
    marginBottom: 16
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink || "#0f172a"
  },
  closeBtn: {
    padding: 4
  },
  closeBtnText: {
    fontSize: 24,
    color: COLORS.muted || "#64748b",
    lineHeight: 24
  },
  scrollContent: {
    paddingBottom: 20
  },
  matchCopy: {
    fontSize: 12,
    color: COLORS.muted || "#64748b",
    marginBottom: 14,
    textAlign: "center"
  },
  picksList: {
    gap: 12,
    marginBottom: 20
  },
  pickItem: {
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.cardHover || "#f1f5f9"
  },
  pickRole: {
    fontSize: 8,
    fontWeight: "900",
    color: COLORS.muted || "#64748b",
    letterSpacing: 0.5
  },
  pickName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink || "#0f172a",
    marginTop: 4
  },
  pickMeta: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    marginTop: 2
  },
  warningText: {
    fontSize: 9,
    fontWeight: "600",
    color: COLORS.warningAmber || "#e8a30e",
    marginTop: 6
  },
  noticeText: {
    fontSize: 10,
    color: COLORS.muted || "#64748b",
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 14
  },
  actions: {
    gap: 10
  },
  confirmBtn: {
    backgroundColor: COLORS.green || "#2d653d",
    borderRadius: 12,
    padding: 14,
    alignItems: "center"
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff"
  },
  disabledBtn: {
    opacity: 0.6
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: COLORS.line || "#e2e8f0",
    borderRadius: 12,
    padding: 14,
    alignItems: "center"
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted || "#64748b"
  }
});
