import React from "react";
import { View, TouchableOpacity, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../theme/colors";

export type BottomTab = "matches" | "support" | "players" | "profile";

interface BottomTabBarProps {
  activeTab: BottomTab;
  onTabPress: (tab: BottomTab) => void;
}

const TABS: Array<{ key: BottomTab; label: string; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }> = [
  { key: "matches", label: "Matches", icon: "football-outline", iconActive: "football" },
  { key: "support", label: "Support", icon: "heart-outline", iconActive: "heart" },
  { key: "players", label: "Players", icon: "people-outline", iconActive: "people" },
  { key: "profile", label: "Profile", icon: "person-outline", iconActive: "person" },
];

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab, onTabPress }) => {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
              <Ionicons
                name={isActive ? tab.iconActive : tab.icon}
                size={20}
                color={isActive ? COLORS.primary : COLORS.textSecondary}
              />
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    width: 36,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  iconWrapActive: {
    backgroundColor: COLORS.primaryMuted,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  labelActive: {
    color: COLORS.primary,
    fontWeight: "800",
  },
});
