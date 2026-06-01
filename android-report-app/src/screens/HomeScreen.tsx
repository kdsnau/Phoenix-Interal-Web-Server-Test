import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getLastSubmission } from '../services/notifications';
import { getUnsentReports } from '../db/clients';
import { theme } from '../constants/theme';
import type { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
  route: { params: { userName: string } };
};

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 60)  return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ navigation, route }: Props) {
  const { userName } = route.params;
  const [lastReport, setLastReport]    = useState<Date | null>(null);
  const [unsentCount, setUnsentCount]  = useState(0);

  useFocusEffect(
    useCallback(() => {
      getLastSubmission().then(setLastReport);
      getUnsentReports().then(r => setUnsentCount(r.length));
    }, [])
  );

  const submittedToday = lastReport
    ? new Date(lastReport).toDateString() === new Date().toDateString()
    : false;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>PHX</Text>
          <Text style={styles.brandSub}>Field Reports</Text>
        </View>

        {/* Greeting */}
        <Text style={styles.greeting}>{greeting()},</Text>
        <Text style={styles.userName}>{userName}</Text>

        {/* Status Card */}
        <View style={[styles.statusCard, submittedToday ? styles.statusGood : styles.statusWarn]}>
          <View style={submittedToday ? styles.dotGood : styles.dotWarn} />
          <View style={styles.statusText}>
            {submittedToday ? (
              <>
                <Text style={styles.statusTitle}>Report submitted</Text>
                <Text style={styles.statusSub}>
                  {lastReport ? timeAgo(lastReport) : ''}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.statusTitle}>No report submitted today</Text>
                <Text style={styles.statusSub}>
                  {lastReport
                    ? `Last report: ${timeAgo(lastReport)}`
                    : 'Tap below to submit your first report'}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Queued offline badge */}
        {unsentCount > 0 && (
          <View style={styles.queueCard}>
            <Text style={styles.queueText}>
              {unsentCount} report{unsentCount > 1 ? 's' : ''} queued — will send when connected
            </Text>
          </View>
        )}

        {/* Main CTA */}
        <TouchableOpacity
          style={styles.submitBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ReportForm', { userName })}
        >
          <Text style={styles.submitBtnText}>Submit Report</Text>
          <Text style={styles.submitBtnSub}>Takes under 2 minutes</Text>
        </TouchableOpacity>

        {/* Footer note */}
        <Text style={styles.footerNote}>
          You'll be reminded every 4 hours if a report hasn't been submitted.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: theme.bg0 },
  scroll: {
    flexGrow:          1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop:        theme.spacing.xl,
    paddingBottom:     theme.spacing.xxl,
  },
  header: {
    alignItems:   'center',
    marginBottom: theme.spacing.xxl,
  },
  brand: {
    color:       theme.accent,
    fontSize:    32,
    fontWeight:  '900',
    letterSpacing: 6,
  },
  brandSub: {
    color:       theme.subtext,
    fontSize:    theme.font.sm,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop:   2,
  },
  greeting: {
    color:    theme.subtext,
    fontSize: theme.font.lg,
  },
  userName: {
    color:        theme.text,
    fontSize:     theme.font.xxl,
    fontWeight:   '700',
    marginBottom: theme.spacing.xl,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems:    'center',
    borderRadius:  theme.radius.lg,
    padding:       theme.spacing.lg,
    marginBottom:  theme.spacing.md,
    borderWidth:   1,
  },
  statusGood: {
    backgroundColor: 'rgba(39,174,96,0.12)',
    borderColor:     theme.success,
  },
  statusWarn: {
    backgroundColor: 'rgba(212,85,43,0.12)',
    borderColor:     theme.accent,
  },
  dotGood: {
    width:           12,
    height:          12,
    borderRadius:    6,
    backgroundColor: theme.success,
    marginRight:     theme.spacing.md,
    flexShrink:      0,
  },
  dotWarn: {
    width:           12,
    height:          12,
    borderRadius:    6,
    backgroundColor: theme.accent,
    marginRight:     theme.spacing.md,
    flexShrink:      0,
  },
  statusText: { flex: 1 },
  statusTitle: {
    color:      theme.text,
    fontSize:   theme.font.md,
    fontWeight: '600',
  },
  statusSub: {
    color:    theme.subtext,
    fontSize: theme.font.sm,
    marginTop: 2,
  },
  queueCard: {
    backgroundColor: 'rgba(231,196,0,0.1)',
    borderWidth:     1,
    borderColor:     '#c4a400',
    borderRadius:    theme.radius.md,
    padding:         theme.spacing.md,
    marginBottom:    theme.spacing.md,
  },
  queueText: {
    color:    '#e8c800',
    fontSize: theme.font.sm,
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: theme.accent,
    borderRadius:    theme.radius.xl,
    paddingVertical: theme.spacing.xl,
    alignItems:      'center',
    marginTop:       theme.spacing.lg,
    elevation:       4,
    shadowColor:     theme.accent,
    shadowOpacity:   0.4,
    shadowRadius:    12,
    shadowOffset:    { width: 0, height: 4 },
  },
  submitBtnText: {
    color:      theme.white,
    fontSize:   theme.font.xl,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  submitBtnSub: {
    color:    'rgba(255,255,255,0.65)',
    fontSize: theme.font.sm,
    marginTop: 4,
  },
  footerNote: {
    color:     theme.placeholder,
    fontSize:  theme.font.sm - 1,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
    lineHeight: 18,
  },
});
