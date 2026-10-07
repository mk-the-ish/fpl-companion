import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#00ff87",
        tabBarInactiveTintColor: "#94a3b8",
        headerStyle: { backgroundColor: "#37003c" },
        headerTintColor: "#ffffff",
        tabBarStyle: { backgroundColor: "#1e1b4b", borderTopColor: "#312e81" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Live Hub",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}