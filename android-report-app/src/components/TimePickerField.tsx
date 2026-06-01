import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { theme } from '../constants/theme';

interface Props {
  arrival:   string;
  departure: string;
  onArrival:   (val: string) => void;
  onDeparture: (val: string) => void;
}

function fmt(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function parseTime(str: string): Date {
  if (!str) return new Date();
  const base  = new Date();
  const match = str.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return base;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  base.setHours(h, m, 0, 0);
  return base;
}

type Slot = 'arrival' | 'departure' | null;

export default function TimePickerField({ arrival, departure, onArrival, onDeparture }: Props) {
  const [showing, setShowing] = useState<Slot>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const open = (slot: Slot) => {
    const existing = slot === 'arrival' ? arrival : departure;
    setTempDate(existing ? parseTime(existing) : new Date());
    setShowing(slot);
  };

  const onChange = (_: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowing(null);
    if (!date) return;
    if (showing === 'arrival')   onArrival(fmt(date));
    if (showing === 'departure') onDeparture(fmt(date));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Site Arrival & Departure Times</Text>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.chip, !arrival && styles.chipEmpty]} onPress={() => open('arrival')}>
          <Text style={styles.chipLabel}>Arrival</Text>
          <Text style={[styles.chipValue, !arrival && styles.chipValueEmpty]}>
            {arrival || 'Tap to set'}
          </Text>
        </TouchableOpacity>

        <View style={styles.dash}>
          <Text style={styles.dashText}>—</Text>
        </View>

        <TouchableOpacity style={[styles.chip, !departure && styles.chipEmpty]} onPress={() => open('departure')}>
          <Text style={styles.chipLabel}>Departure</Text>
          <Text style={[styles.chipValue, !departure && styles.chipValueEmpty]}>
            {departure || 'Tap to set'}
          </Text>
        </TouchableOpacity>
      </View>

      {showing !== null && (
        <DateTimePicker
          mode="time"
          value={tempDate}
          is24Hour={false}
          display="default"
          onChange={onChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    color:         theme.subtext,
    fontSize:      theme.font.sm,
    marginBottom:  theme.spacing.sm,
    fontWeight:    '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  chip: {
    flex:            1,
    backgroundColor: theme.bg3,
    borderWidth:     1,
    borderColor:     theme.accent,
    borderRadius:    theme.radius.md,
    padding:         theme.spacing.md - 2,
    alignItems:      'center',
  },
  chipEmpty: {
    borderColor: theme.border,
  },
  chipLabel: {
    color:        theme.subtext,
    fontSize:     theme.font.sm - 1,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipValue: {
    color:      theme.text,
    fontSize:   theme.font.md,
    fontWeight: '600',
  },
  chipValueEmpty: {
    color:      theme.placeholder,
    fontWeight: '400',
  },
  dash: {
    paddingHorizontal: theme.spacing.sm,
  },
  dashText: {
    color:    theme.subtext,
    fontSize: theme.font.lg,
  },
});
