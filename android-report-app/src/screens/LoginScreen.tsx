import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getUser, saveUser, verifyPin } from '../storage/user';
import { theme } from '../constants/theme';
import type { RootStackParamList } from '../../App';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Login'> };

export default function LoginScreen({ navigation }: Props) {
  const [mode, setMode]       = useState<'loading' | 'setup' | 'pin'>('loading');
  const [name, setName]       = useState('');
  const [pin, setPin]         = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError]     = useState('');
  const [storedName, setStoredName] = useState('');

  useEffect(() => {
    getUser().then(user => {
      if (user) {
        setStoredName(user.name);
        setMode('pin');
      } else {
        setMode('setup');
      }
    });
  }, []);

  const handleSetup = async () => {
    setError('');
    if (name.trim().length < 2) { setError('Enter your full name.'); return; }
    if (pin.length !== 4)       { setError('PIN must be 4 digits.'); return; }
    if (pin !== confirmPin)     { setError('PINs do not match.'); return; }
    await saveUser(name.trim(), pin);
    navigation.replace('Home', { userName: name.trim() });
  };

  const handlePin = async () => {
    setError('');
    const ok = await verifyPin(pin);
    if (!ok) { setError('Incorrect PIN.'); setPin(''); return; }
    navigation.replace('Home', { userName: storedName });
  };

  if (mode === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.inner}>
          <View style={styles.brandRow}>
            <Text style={styles.brandName}>PHX</Text>
            <Text style={styles.brandSub}>Field Reports</Text>
          </View>

          {mode === 'setup' ? (
            <>
              <Text style={styles.heading}>Set up your profile</Text>
              <Text style={styles.sub}>Your name pre-fills every report. Your PIN keeps the app secure.</Text>

              <Text style={styles.label}>Your Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="words"
                autoFocus
              />

              <Text style={styles.label}>4-Digit PIN</Text>
              <TextInput
                style={styles.input}
                value={pin}
                onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={theme.placeholder}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
              />

              <Text style={styles.label}>Confirm PIN</Text>
              <TextInput
                style={styles.input}
                value={confirmPin}
                onChangeText={t => setConfirmPin(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={theme.placeholder}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity style={styles.btn} onPress={handleSetup}>
                <Text style={styles.btnText}>Get Started</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.heading}>Welcome back,</Text>
              <Text style={styles.nameDisplay}>{storedName}</Text>

              <Text style={styles.label}>Enter PIN</Text>
              <TextInput
                style={[styles.input, styles.pinInput]}
                value={pin}
                onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={theme.placeholder}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                autoFocus
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity style={styles.btn} onPress={handlePin}>
                <Text style={styles.btnText}>Unlock</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.switchLink}
                onPress={() => { setMode('setup'); setPin(''); setError(''); }}
              >
                <Text style={styles.switchText}>I'm someone else</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: theme.bg0 },
  center: { flex: 1, backgroundColor: theme.bg0, alignItems: 'center', justifyContent: 'center' },
  kav:    { flex: 1 },
  inner: {
    flex:              1,
    paddingHorizontal: theme.spacing.xl,
    justifyContent:    'center',
  },
  brandRow: {
    alignItems:    'center',
    marginBottom:  theme.spacing.xxl,
  },
  brandName: {
    color:       theme.accent,
    fontSize:    38,
    fontWeight:  '900',
    letterSpacing: 6,
  },
  brandSub: {
    color:       theme.subtext,
    fontSize:    theme.font.md,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop:   4,
  },
  heading: {
    color:        theme.text,
    fontSize:     theme.font.xl,
    fontWeight:   '700',
    marginBottom: theme.spacing.xs,
  },
  sub: {
    color:        theme.subtext,
    fontSize:     theme.font.md,
    marginBottom: theme.spacing.xl,
    lineHeight:   22,
  },
  nameDisplay: {
    color:        theme.accent,
    fontSize:     theme.font.xxl,
    fontWeight:   '700',
    marginBottom: theme.spacing.xl,
  },
  label: {
    color:        theme.subtext,
    fontSize:     theme.font.sm,
    fontWeight:   '600',
    marginBottom: theme.spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: theme.bg3,
    borderWidth:     1,
    borderColor:     theme.border,
    borderRadius:    theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical:   theme.spacing.md - 2,
    color:           theme.text,
    fontSize:        theme.font.md,
    marginBottom:    theme.spacing.md,
  },
  pinInput: {
    textAlign:  'center',
    fontSize:   theme.font.xl,
    letterSpacing: 12,
  },
  error: {
    color:        theme.danger,
    fontSize:     theme.font.sm,
    marginBottom: theme.spacing.sm,
    textAlign:    'center',
  },
  btn: {
    backgroundColor: theme.accent,
    borderRadius:    theme.radius.md,
    padding:         theme.spacing.md,
    alignItems:      'center',
    marginTop:       theme.spacing.sm,
  },
  btnText: {
    color:      theme.white,
    fontSize:   theme.font.lg,
    fontWeight: '700',
  },
  switchLink: {
    alignItems: 'center',
    marginTop:  theme.spacing.lg,
  },
  switchText: {
    color:    theme.subtext,
    fontSize: theme.font.sm,
  },
});
