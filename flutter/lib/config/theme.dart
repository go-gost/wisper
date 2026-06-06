/// Wisper theme definitions — light and dark.
///
/// Colors follow the HTML prototype CSS variables:
/// - Light: Indigo primary, BlueGrey surfaces
/// - Dark:  Green primary, Grey surfaces
library;

import 'package:flutter/material.dart';

/// Wisper light theme.
final lightTheme = ThemeData(
  brightness: Brightness.light,
  colorSchemeSeed: const Color(0xFF3F51B5), // Indigo 500
  useMaterial3: true,
  scaffoldBackgroundColor: Colors.white,
  cardTheme: const CardThemeData(
    color: Color(0xFFF5F5F5), // Grey 50
    elevation: 1,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(16)),
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.white,
    elevation: 0,
    scrolledUnderElevation: 0,
  ),
);

/// Wisper dark theme.
final darkTheme = ThemeData(
  brightness: Brightness.dark,
  colorSchemeSeed: const Color(0xFF4CAF50), // Green 500
  useMaterial3: true,
  scaffoldBackgroundColor: const Color(0xFF212121), // Grey 900
  cardTheme: const CardThemeData(
    color: Color(0xFF424242), // Grey 800
    elevation: 1,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(16)),
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xFF212121),
    elevation: 0,
    scrolledUnderElevation: 0,
  ),
);
